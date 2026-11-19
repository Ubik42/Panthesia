//! Preserve song expression beneath the user's master volume, including controller resets.
pub(crate) struct ExpressionGain {
    volume: f64,
    expression: [u8; 16],
}
impl Default for ExpressionGain {
    fn default() -> Self {
        Self {
            volume: 1.,
            expression: [127; 16],
        }
    }
}
impl ExpressionGain {
    fn controller(&self, channel: usize) -> [u8; 3] {
        [
            0xb0 | channel as u8,
            11,
            (f64::from(self.expression[channel]) * self.volume)
                .round()
                .clamp(0., 127.) as u8,
        ]
    }
    pub fn set_volume(
        &mut self,
        volume: f64,
        mut emit: impl FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        self.volume = volume.clamp(0., 1.);
        for channel in 0..16 {
            emit(&self.controller(channel))?;
        }
        Ok(())
    }
    pub fn send(
        &mut self,
        bytes: &[u8],
        mut emit: impl FnMut(&[u8]) -> Result<(), String>,
    ) -> Result<(), String> {
        if bytes.len() == 3 && bytes[0] & 0xf0 == 0xb0 {
            let channel = usize::from(bytes[0] & 15);
            if bytes[1] == 11 {
                self.expression[channel] = bytes[2].min(127);
                return emit(&self.controller(channel));
            }
            if bytes[1] == 121 {
                emit(bytes)?;
                self.expression[channel] = 127;
                return emit(&self.controller(channel));
            }
        }
        emit(bytes)?;
        // Universal GM on/reset and MIDI system reset restore expression on every channel.
        if bytes == [0xff]
            || (bytes.len() == 6
                && bytes[0] == 0xf0
                && bytes[1] == 0x7e
                && bytes[3] == 9
                && bytes[5] == 0xf7)
        {
            self.expression.fill(127);
            for channel in 0..16 {
                emit(&self.controller(channel))?;
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn master_expression_preserves_source_controls_and_survives_resets() {
        let mut gain = ExpressionGain::default();
        let mut sent = vec![];
        gain.set_volume(0.5, |bytes| {
            sent.push(bytes.to_vec());
            Ok(())
        })
        .unwrap();
        assert_eq!(sent.len(), 16);
        assert_eq!(sent[0], vec![0xb0, 11, 64]);
        sent.clear();
        for bytes in [&[0xb2, 11, 80][..], &[0xb2, 7, 100], &[0x92, 60, 95]] {
            gain.send(bytes, |bytes| {
                sent.push(bytes.to_vec());
                Ok(())
            })
            .unwrap();
        }
        assert_eq!(
            sent,
            vec![vec![0xb2, 11, 40], vec![0xb2, 7, 100], vec![0x92, 60, 95]]
        );
        gain.set_volume(0., |_| Ok(())).unwrap();
        sent.clear();
        gain.send(&[0xb2, 121, 0], |bytes| {
            sent.push(bytes.to_vec());
            Ok(())
        })
        .unwrap();
        assert_eq!(sent, vec![vec![0xb2, 121, 0], vec![0xb2, 11, 0]]);
        sent.clear();
        gain.set_volume(0.5, |bytes| {
            sent.push(bytes.to_vec());
            Ok(())
        })
        .unwrap();
        assert_eq!(sent[2], vec![0xb2, 11, 64]);
        gain.send(&[0xf0, 0x7e, 0x7f, 9, 1, 0xf7], |_| Ok(()))
            .unwrap();
    }
}
