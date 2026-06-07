//! Encrypted transport frame helpers.
//!
//! Frame format:
//! - prefix: 6 bytes, printable ASCII (`GET /N`)
//! - length: 2 bytes, big endian, length of body
//! - body: nonce(12) + AES-256-GCM(ciphertext + tag)
//!
//! Plaintext inside AES-GCM:
//! - version: 1 byte
//! - payload_len: 2 bytes
//! - padding_len: 1 byte
//! - payload
//! - random padding

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::{rngs::OsRng, Rng, RngCore};
use sha2::{Digest, Sha256};

use crate::{
    error::{ProtocolError, ProxyError},
    extract_auth_byte_from_prefix, generate_protocol_prefix, verify_first_auth_byte, Result,
};

const VERSION: u8 = 1;
const PREFIX_LEN: usize = 6;
const LEN_LEN: usize = 2;
const NONCE_LEN: usize = 12;
const GCM_TAG_LEN: usize = 16;
const HEADER_LEN: usize = 4;

pub const MAX_FRAME_BODY_LEN: usize = u16::MAX as usize;
pub const DEFAULT_MAX_PADDING: usize = 31;

fn crypto_err(message: impl Into<String>) -> ProxyError {
    ProxyError::Crypto(message.into())
}

fn cipher_from_secret(shared_secret: &[u8]) -> Result<Aes256Gcm> {
    if shared_secret.is_empty() {
        return Err(ProtocolError::AuthenticationFailed.into());
    }

    let mut hasher = Sha256::new();
    hasher.update(b"xway-frame-v1");
    hasher.update(shared_secret);
    let key = hasher.finalize();

    Aes256Gcm::new_from_slice(&key).map_err(|_| crypto_err("无法创建AES-GCM加密器"))
}

/// Per-connection frame codec. It keeps the derived AEAD key hot instead of
/// hashing the shared secret for every data frame.
#[derive(Clone)]
pub struct FrameCodec {
    cipher: Aes256Gcm,
    shared_secret_byte: u8,
    max_time_diff_secs: u64,
}

impl FrameCodec {
    pub fn new(shared_secret: &[u8], max_time_diff_secs: u64) -> Result<Self> {
        Ok(Self {
            cipher: cipher_from_secret(shared_secret)?,
            shared_secret_byte: shared_secret.first().copied().unwrap_or(0),
            max_time_diff_secs,
        })
    }

    /// Encodes one encrypted, authenticated, padded frame.
    pub fn encode(&self, payload: &[u8], auth_byte: u8, max_padding: usize) -> Result<Vec<u8>> {
        if auth_byte > 8 {
            return Err(ProtocolError::InvalidFormat.into());
        }
        if payload.len() > u16::MAX as usize {
            return Err(ProtocolError::InvalidLength.into());
        }

        let fixed_body_overhead = NONCE_LEN + GCM_TAG_LEN + HEADER_LEN;
        if payload.len() + fixed_body_overhead > MAX_FRAME_BODY_LEN {
            return Err(ProtocolError::InvalidLength.into());
        }

        let padding_capacity = MAX_FRAME_BODY_LEN - fixed_body_overhead - payload.len();
        let max_padding = max_padding.min(padding_capacity).min(u8::MAX as usize);
        let padding_len = if max_padding == 0 {
            0
        } else {
            OsRng.gen_range(0..=max_padding)
        };

        let mut plaintext = Vec::with_capacity(HEADER_LEN + payload.len() + padding_len);
        plaintext.push(VERSION);
        plaintext.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        plaintext.push(padding_len as u8);
        plaintext.extend_from_slice(payload);

        if padding_len > 0 {
            let mut padding = vec![0u8; padding_len];
            OsRng.fill_bytes(&mut padding);
            plaintext.extend_from_slice(&padding);
        }

        let mut nonce = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce);

        let ciphertext = self
            .cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_slice())
            .map_err(|_| ProtocolError::AuthenticationFailed)?;

        let body_len = NONCE_LEN + ciphertext.len();
        if body_len > MAX_FRAME_BODY_LEN {
            return Err(ProtocolError::InvalidLength.into());
        }

        let prefix = generate_protocol_prefix(auth_byte);
        let mut frame = Vec::with_capacity(PREFIX_LEN + LEN_LEN + body_len);
        frame.extend_from_slice(&prefix);
        frame.extend_from_slice(&(body_len as u16).to_be_bytes());
        frame.extend_from_slice(&nonce);
        frame.extend_from_slice(&ciphertext);

        Ok(frame)
    }

    /// Decodes a complete frame and verifies both first-byte auth and AEAD tag.
    pub fn decode(&self, frame: &[u8]) -> Result<(Vec<u8>, u8)> {
        if frame.len() < PREFIX_LEN + LEN_LEN + NONCE_LEN + GCM_TAG_LEN + HEADER_LEN {
            return Err(ProtocolError::InvalidLength.into());
        }

        let prefix = &frame[..PREFIX_LEN];
        let auth_byte =
            extract_auth_byte_from_prefix(prefix).ok_or(ProtocolError::InvalidFormat)?;

        if !verify_first_auth_byte(auth_byte, self.shared_secret_byte, self.max_time_diff_secs) {
            return Err(ProtocolError::AuthenticationFailed.into());
        }

        let body_len = u16::from_be_bytes([frame[PREFIX_LEN], frame[PREFIX_LEN + 1]]) as usize;
        if body_len != frame.len() - PREFIX_LEN - LEN_LEN {
            return Err(ProtocolError::InvalidLength.into());
        }
        if body_len < NONCE_LEN + GCM_TAG_LEN + HEADER_LEN {
            return Err(ProtocolError::InvalidLength.into());
        }

        let body = &frame[PREFIX_LEN + LEN_LEN..];
        let nonce = &body[..NONCE_LEN];
        let ciphertext = &body[NONCE_LEN..];

        let plaintext = self
            .cipher
            .decrypt(Nonce::from_slice(nonce), ciphertext)
            .map_err(|_| ProtocolError::AuthenticationFailed)?;

        if plaintext.len() < HEADER_LEN || plaintext[0] != VERSION {
            return Err(ProtocolError::InvalidFormat.into());
        }

        let payload_len = u16::from_be_bytes([plaintext[1], plaintext[2]]) as usize;
        let padding_len = plaintext[3] as usize;
        if HEADER_LEN + payload_len + padding_len != plaintext.len() {
            return Err(ProtocolError::InvalidLength.into());
        }

        Ok((
            plaintext[HEADER_LEN..HEADER_LEN + payload_len].to_vec(),
            auth_byte,
        ))
    }
}

/// Convenience wrapper for one-off frames.
pub fn encode_obfuscated_frame(
    payload: &[u8],
    shared_secret: &[u8],
    auth_byte: u8,
    max_padding: usize,
) -> Result<Vec<u8>> {
    FrameCodec::new(shared_secret, 0)?.encode(payload, auth_byte, max_padding)
}

/// Convenience wrapper for one-off frames.
pub fn decode_obfuscated_frame(
    frame: &[u8],
    shared_secret: &[u8],
    max_time_diff_secs: u64,
) -> Result<(Vec<u8>, u8)> {
    FrameCodec::new(shared_secret, max_time_diff_secs)?.decode(frame)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip_and_randomizes_ciphertext() {
        let secret = b"unit-test-secret";
        let auth_byte = crate::generate_first_auth_byte(secret[0]);
        let payload = b"example payload";

        let first =
            encode_obfuscated_frame(payload, secret, auth_byte, DEFAULT_MAX_PADDING).unwrap();
        let second =
            encode_obfuscated_frame(payload, secret, auth_byte, DEFAULT_MAX_PADDING).unwrap();
        assert_ne!(first, second);

        let (decoded, returned_auth_byte) = decode_obfuscated_frame(&first, secret, 300).unwrap();
        assert_eq!(decoded, payload);
        assert_eq!(returned_auth_byte, auth_byte);
    }

    #[test]
    fn frame_rejects_wrong_secret() {
        let secret = b"unit-test-secret";
        let auth_byte = crate::generate_first_auth_byte(secret[0]);
        let frame = encode_obfuscated_frame(b"payload", secret, auth_byte, 0).unwrap();

        let result = decode_obfuscated_frame(&frame, b"wrong-secret", 300);
        assert!(result.is_err());
    }
}
