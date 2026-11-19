//! Bounded canonical JSON for validation and content fingerprints, without a full output buffer.
use serde::Serialize;
use std::io::{self, BufWriter, Write};

pub(crate) fn encode<T: Serialize, W: Write>(
    value: &T,
    output: W,
    limit: usize,
    check: impl Fn() -> Result<(), String>,
) -> Result<W, String> {
    struct Bounded<'a, W> {
        output: W,
        size: usize,
        limit: usize,
        check: &'a dyn Fn() -> Result<(), String>,
    }
    impl<W: Write> Write for Bounded<'_, W> {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            (self.check)().map_err(io::Error::other)?;
            if bytes.len() > self.limit.saturating_sub(self.size) {
                return Err(io::Error::other("序列化资料超过容量上限"));
            }
            self.output.write_all(bytes)?;
            self.size += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            self.output.flush()
        }
    }
    check()?;
    let bounded = Bounded {
        output,
        size: 0,
        limit,
        check: &check,
    };
    let mut buffered = BufWriter::with_capacity(64 * 1024, bounded);
    serde_json::to_writer(&mut buffered, value).map_err(|error| error.to_string())?;
    buffered.flush().map_err(|error| error.to_string())?;
    check()?;
    buffered
        .into_inner()
        .map(|bounded| bounded.output)
        .map_err(|error| error.to_string())
}

pub(crate) fn measure<T: Serialize>(
    value: &T,
    limit: usize,
    check: impl Fn() -> Result<(), String>,
) -> Result<usize, String> {
    struct Count(usize);
    impl Write for Count {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0 = self
                .0
                .checked_add(bytes.len())
                .ok_or_else(|| io::Error::other("序列化大小无效"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    encode(value, Count(0), limit, check).map(|count| count.0)
}
