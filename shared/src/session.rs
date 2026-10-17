use rand::{rngs::OsRng, RngCore};

use crate::{AuthPacket, ProtocolError, Result};

pub const SESSION_SALT_LEN: usize = 32;

#[derive(Debug)]
pub struct ClientHello {
    pub salt: [u8; SESSION_SALT_LEN],
    pub auth: Option<AuthPacket>,
}

impl ClientHello {
    pub fn new(auth: Option<AuthPacket>) -> Self {
        let mut salt = [0u8; SESSION_SALT_LEN];
        OsRng.fill_bytes(&mut salt);
        Self { salt, auth }
    }

    pub fn encode(&self) -> Vec<u8> {
        let auth = self
            .auth
            .as_ref()
            .map(AuthPacket::serialize)
            .unwrap_or_default();
        let mut out = Vec::with_capacity(SESSION_SALT_LEN + 2 + auth.len());
        out.extend_from_slice(&self.salt);
        out.extend_from_slice(&(auth.len() as u16).to_be_bytes());
        out.extend_from_slice(&auth);
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
        if bytes.len() != SESSION_SALT_LEN + 2 + len {
            return Err(ProtocolError::InvalidLength.into());
        }
        let auth = if len == 0 {
            None
        } else {
            Some(AuthPacket::deserialize(&bytes[SESSION_SALT_LEN + 2..])?)
        };
        Ok(Self { salt, auth })
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

    pub fn decode(bytes: &[u8]) -> Result<Self> {
        match bytes {
            [0] => Ok(Self::Success),
            [1] => Ok(Self::Failure),
            _ => Err(ProtocolError::InvalidFormat.into()),
        }
    }
}
