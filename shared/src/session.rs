use rand::{rngs::OsRng, RngCore};

use crate::{AuthPacket, ProtocolError, Result};

pub const SESSION_SALT_LEN: usize = 32;
pub const MAX_SUBFLOWS: u8 = 8;

#[derive(Debug)]
pub struct ClientHello {
    pub salt: [u8; SESSION_SALT_LEN],
    pub auth: Option<AuthPacket>,
    /// Requested multipath subflow count. 1 keeps the legacy wire format
    /// (no extra byte), so old servers keep working for single-path clients.
    pub subflows: u8,
}

impl ClientHello {
    pub fn new(auth: Option<AuthPacket>) -> Self {
        let mut salt = [0u8; SESSION_SALT_LEN];
        OsRng.fill_bytes(&mut salt);
        Self {
            salt,
            auth,
            subflows: 1,
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        let auth = self
            .auth
            .as_ref()
            .map(AuthPacket::serialize)
            .unwrap_or_default();
        let mut out = Vec::with_capacity(SESSION_SALT_LEN + 2 + auth.len() + 1);
        out.extend_from_slice(&self.salt);
        out.extend_from_slice(&(auth.len() as u16).to_be_bytes());
        out.extend_from_slice(&auth);
        if self.subflows > 1 {
            out.push(self.subflows);
        }
        out
    }

    pub fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < SESSION_SALT_LEN + 2 {
            return Err(ProtocolError::InvalidLength.into());
        }
        let mut salt = [0u8; SESSION_SALT_LEN];
        salt.copy_from_slice(&bytes[..SESSION_SALT_LEN]);
        let len =
            u16::from_be_bytes([bytes[SESSION_SALT_LEN], bytes[SESSION_SALT_LEN + 1]]) as usize;
        let auth_end = SESSION_SALT_LEN + 2 + len;
        if bytes.len() < auth_end {
            return Err(ProtocolError::InvalidLength.into());
        }
        let auth = if len == 0 {
            None
        } else {
            Some(AuthPacket::deserialize(&bytes[SESSION_SALT_LEN + 2..auth_end])?)
        };
        let subflows = match bytes.len() - auth_end {
            0 => 1,
            1 => {
                let value = bytes[auth_end];
                if !(1..=MAX_SUBFLOWS).contains(&value) {
                    return Err(ProtocolError::InvalidFormat.into());
                }
                value
            }
            _ => return Err(ProtocolError::InvalidLength.into()),
        };
        Ok(Self {
            salt,
            auth,
            subflows,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectResponse {
    Success,
    Failure,
}

impl ConnectResponse {
    pub fn encode(self) -> [u8; 1] {
        [match self {
            Self::Success => 0,
            Self::Failure => 1,
        }]
    }

    /// Extended response for multipath sessions: `[status, actual_subflows]`.
    /// The client relies on the count to close surplus join connections.
    pub fn encode_multipath(self, subflows: u8) -> [u8; 2] {
        [self.encode()[0], subflows]
    }

    /// Accepts both the legacy 1-byte form and the 2-byte multipath form.
    /// Returns the response plus the negotiated subflow count (1 for legacy).
    pub fn decode(bytes: &[u8]) -> Result<(Self, u8)> {
        match bytes {
            [0] | [0, _] => {
                let subflows = match bytes {
                    [_, n] if (1..=MAX_SUBFLOWS).contains(n) => *n,
                    [_] => 1,
                    _ => return Err(ProtocolError::InvalidFormat.into()),
                };
                Ok((Self::Success, subflows))
            }
            [1] | [1, _] => Ok((Self::Failure, 1)),
            _ => Err(ProtocolError::InvalidFormat.into()),
        }
    }
}
