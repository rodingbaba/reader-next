use md5::{Digest, Md5};

pub fn md5_hex(input: &str) -> String {
    md5_bytes(input.as_bytes())
}

pub fn md5_bytes(input: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(input);
    let result = hasher.finalize();
    hex::encode(result)
}
