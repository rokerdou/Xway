//! Printable wire prefix and lightweight first-byte authentication.

/// Wire prefix template: `GET /X`, where `X` is a digit.
pub const PROTOCOL_PREFIX_TEMPLATE: &[u8] = b"GET /X";

/// Build a 6-byte printable prefix carrying an auth digit.
#[inline(always)]
pub fn generate_protocol_prefix(auth_byte: u8) -> [u8; 6] {
    debug_assert!(auth_byte <= 8, "auth byte must be in 0..=8");
    [b'G', b'E', b'T', b' ', b'/', b'0' + auth_byte]
}

/// Extract the auth digit from a `GET /N` prefix.
#[inline(always)]
pub fn extract_auth_byte_from_prefix(prefix: &[u8]) -> Option<u8> {
    if prefix.len() == 6 && &prefix[0..5] == b"GET /" && (b'0'..=b'8').contains(&prefix[5]) {
        Some(prefix[5] - b'0')
    } else {
        None
    }
}

/// Generate first-byte auth from current minute and the first shared-secret byte.
pub fn generate_first_auth_byte(shared_secret: u8) -> u8 {
    use std::time::{SystemTime, UNIX_EPOCH};

    let minute_digit = ((SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 60)
        % 10) as u32;
    ((minute_digit + shared_secret as u32) % 9) as u8
}

/// Verify first-byte auth within a backward-looking time tolerance.
pub fn verify_first_auth_byte(received: u8, shared_secret: u8, time_tolerance_secs: u64) -> bool {
    use std::time::{SystemTime, UNIX_EPOCH};

    if received > 8 {
        return false;
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    for offset in 0..=(time_tolerance_secs / 60) {
        let minute = (((now / 60).saturating_sub(offset)) % 10) as u32;
        let expected = ((minute + shared_secret as u32) % 9) as u8;
        if received == expected {
            return true;
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_is_printable_and_roundtrips_auth_digit() {
        for auth_byte in 0..=8 {
            let prefix = generate_protocol_prefix(auth_byte);
            assert!(prefix.iter().all(|byte| (0x20..=0x7e).contains(byte)));
            assert_eq!(extract_auth_byte_from_prefix(&prefix), Some(auth_byte));
        }
    }

    #[test]
    fn first_auth_byte_verifies_current_time() {
        let secret = b's';
        let auth_byte = generate_first_auth_byte(secret);
        assert!(verify_first_auth_byte(auth_byte, secret, 300));
        assert!(!verify_first_auth_byte((auth_byte + 1) % 9, secret, 0));
    }
}
