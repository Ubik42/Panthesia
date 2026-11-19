use std::{fs::File, hint::black_box, sync::Arc, time::Instant};
fn main() {
    let path = std::env::args().nth(1).unwrap();
    for voices in [8, 64] {
        let font = oxisynth::SoundFont::load(&mut File::open(&path).unwrap()).unwrap();
        let mut synth = oxisynth::Synth::new(oxisynth::SynthDescriptor {
            sample_rate: 48000.,
            polyphony: 128,
            ..Default::default()
        })
        .unwrap();
        synth.add_font(font, true);
        let start = Instant::now();
        let mut energy = 0.;
        for block in 0..1000 {
            if block % 20 == 0 {
                let _ = synth.send_event(oxisynth::MidiEvent::AllSoundOff { channel: 0 });
                for n in 0..voices {
                    let _ = synth.send_event(oxisynth::MidiEvent::NoteOn {
                        channel: 0,
                        key: 36 + n,
                        vel: 90,
                    });
                }
            }
            for _ in 0..480 {
                let (l, r) = synth.read_next();
                energy += f64::from(l * l + r * r);
            }
        }
        println!(
            "{{\"synth\":\"oxisynth-0.1\",\"voices\":{voices},\"audioSeconds\":10,\"renderMs\":{},\"energy\":{}}}",
            start.elapsed().as_secs_f64() * 1000.,
            black_box(energy)
        );
        let font = Arc::new(rustysynth::SoundFont::new(&mut File::open(&path).unwrap()).unwrap());
        let mut settings = rustysynth::SynthesizerSettings::new(48000);
        settings.maximum_polyphony = 128;
        let mut synth = rustysynth::Synthesizer::new(&font, &settings).unwrap();
        let mut l = [0f32; 480];
        let mut r = [0f32; 480];
        let start = Instant::now();
        let mut energy = 0.;
        for block in 0..1000 {
            if block % 20 == 0 {
                synth.note_off_all(true);
                for n in 0..voices {
                    synth.note_on(0, i32::from(36 + n), 90);
                }
            }
            synth.render(&mut l, &mut r);
            energy += l
                .iter()
                .zip(&r)
                .map(|(l, r)| f64::from(l * l + r * r))
                .sum::<f64>();
        }
        println!(
            "{{\"synth\":\"rustysynth\",\"voices\":{voices},\"audioSeconds\":10,\"renderMs\":{},\"energy\":{}}}",
            start.elapsed().as_secs_f64() * 1000.,
            black_box(energy)
        );
    }
    let (_tx, rx) = std::sync::mpsc::sync_channel::<u8>(2048);
    let start = Instant::now();
    for _ in 0..4_800_000 {
        black_box(rx.try_recv()).ok();
    }
    let old = start.elapsed().as_secs_f64() * 1000.;
    let (_tx, mut rx) = rtrb::RingBuffer::<u8>::new(2048);
    let start = Instant::now();
    for _ in 0..75_000 {
        black_box(rx.pop()).ok();
    }
    let new = start.elapsed().as_secs_f64() * 1000.;
    println!("{{\"queueWorkFor100Seconds\":true,\"oldMs\":{old},\"newMs\":{new}}}");
}
