//! Display preparation is called by asset_read_task's detached reader.
use crate::*;
impl Player {
    pub(super) fn practice_key(&self) -> (i8, bool) {
        let Some(file) = self.source_file.as_ref().or(self.file.as_ref()) else {
            return (0, false);
        };
        let source=crate::practice_keys::source(file,self.notation.as_deref());
        key_for(&source, &self.variant())
    }
    pub(super) fn score_view_payload(
        &self,
        first: Option<usize>,
        position: Option<f64>,
        source: bool,
    ) -> Result<serde_json::Value, String> {
        let variant = self.variant();
        if source || (variant.quantize == 0 && self.notation.is_some()) {
            let Some(asset)=self.notation.as_ref() else {return Ok(serde_json::Value::Null);};
            let file=self.file.as_ref().ok_or("请先选择曲目")?;
            return asset.source_view.payload(asset,file,self.score_revision,variant.transpose,first,position);
        }
        let file = self.file.as_ref().ok_or("请先选择曲目")?;
        let total = file.musical_time.measures.len();
        if total == 0 {
            return Err("当前演奏缺少小节范围".into());
        }
        let requested = if let Some(first) = first {
            if first >= total {
                return Err("小节范围已改变".into());
            }
            first
        } else {
            let time = position.filter(|p| p.is_finite() && *p >= 0.).unwrap_or(0.);
            let tick = file.tempo_track.seconds_to_pulses(time).round().max(0.) as u64;
            file.musical_time
                .measures
                .partition_point(|m| m.end_tick <= tick)
                .min(total - 1)
                / 32
                * 32
        };
        let range = panthesia_core::practice_engraving::MeasureRange {
            first: requested,
            count: (total - requested).min(32),
        };
        let (fifths, minor) = self.practice_key();
        let staff = |track, index, pitch| match crate::hands::part(
            &self.config,
            &self.note_hands,
            track,
            index,
        ) {
            PracticePart::LeftHand => 2,
            PracticePart::RightHand => 1,
            _ => {
                if pitch >= 60 {
                    1
                } else {
                    2
                }
            }
        };
        let key_source=crate::practice_keys::source(self.source_file.as_ref().unwrap_or(file),self.notation.as_deref());
        let keys=crate::practice_keys::engraving(&key_source,&variant,fifths,minor);
        let engraving = panthesia_core::practice_engraving::engrave_range_with_keys(
            file,
            &self.title,
            fifths,
            minor,
            variant.quantize == 0,
            range,
            &staff,
            &keys,
            &|| Ok(()),
        )?;
        let start = &file.musical_time.measures[range.first];
        let last = &file.musical_time.measures[range.first + range.count - 1];
        Ok(serde_json::json!({
            "contentId":file.content_id,"scoreRevision":self.score_revision,"sourceFingerprint":self.score_display_origin(),
            "displayFingerprint":blake3::hash(&engraving.bytes).to_hex().to_string(),"bytes":engraving.bytes,
            "name":self.title,"compressed":false,"practiceNotation":true,"practiceNotationKind":if variant.quantize==0 {"simplified"}else{"quantized"},
            "alignmentSource":"practiceIdentity","coverage":100,"confidence":100,"readiness":"Ready","diagnostics":[],"warnings":[],
            "window":{"first":range.first,"count":range.count,"total":total,"start":file.tempo_track.pulses_to_duration(start.start_tick).as_secs_f64(),"end":file.tempo_track.pulses_to_duration(last.end_tick).as_secs_f64(),"firstNumber":start.display_number,"lastNumber":last.display_number}
        }))
    }

    pub(super) fn score_display_origin(&self) -> String {
        self.notation
            .as_ref()
            .map(|asset| asset.source_fingerprint.clone())
            .unwrap_or_else(|| {
                format!(
                    "midi:{}",
                    self.file
                        .as_ref()
                        .map_or("", |file| file.content_id.as_str())
                )
            })
    }
    pub(super) fn score_payload(&self, practice: bool) -> Result<serde_json::Value, String> {
        let variant = self.variant();
        if self.notation.is_none() && !practice {
            return Ok(serde_json::Value::Null);
        }
        let mut payload = self.notation.as_ref().map_or_else(||serde_json::json!({"name":self.title,"sourceFingerprint":self.score_display_origin(),"warnings":[]}),|asset|asset.route_payload(self.file.as_deref()));
        if practice && (variant.quantize != 0 || self.notation.is_none()) {
            let file = self.file.as_ref().ok_or("请先选择曲目")?;
            let info = self.variant_document();
            let minor = info["minor"].as_bool().unwrap_or(false);
            let tonic =
                (info["tonic"].as_i64().unwrap_or(0) + i64::from(variant.transpose)).rem_euclid(12);
            let fifths = (-7i8..=7)
                .filter(|f| (i64::from(*f) * 7 + if minor { 9 } else { 0 }).rem_euclid(12) == tonic)
                .min_by_key(|f| f.abs())
                .unwrap_or(0);
            let simplified = variant.quantize == 0;
            let engraving = if simplified {
                panthesia_core::practice_engraving::engrave_simplified(
                    file,
                    &self.title,
                    fifths,
                    minor,
                    &|| Ok(()),
                )
            } else {
                panthesia_core::practice_engraving::engrave(
                    file,
                    &self.title,
                    fifths,
                    minor,
                    &|| Ok(()),
                )
            }?;
            let edition = panthesia_core::song_project::PracticeEdition::new(
                &file.content_id,
                variant.clone(),
            )?;
            payload["displayEditionId"] = serde_json::json!(format!(
                "{}:{}:{}",
                edition.id,
                panthesia_core::practice_engraving::GENERATOR,
                if simplified {
                    "simplified-16"
                } else {
                    "performance"
                }
            ));
            payload["displayFingerprint"] =
                serde_json::json!(blake3::hash(&engraving.bytes).to_hex().to_string());
            payload["bytes"] = serde_json::json!(engraving.bytes);
            payload["compressed"] = serde_json::json!(false);
            payload["practiceNotation"] = serde_json::json!(true);
            payload["practiceNotationKind"] = serde_json::json!(if simplified {
                "simplified"
            } else {
                "quantized"
            });
            payload["alignmentSource"] = serde_json::json!("practiceIdentity");
            payload["coverage"] = serde_json::json!(100);
            payload["confidence"] = serde_json::json!(100);
            payload["readiness"] = serde_json::json!("Ready");
            payload["diagnostics"] = serde_json::json!([]);
            payload["warnings"] = serde_json::json!([if simplified {
                "MIDI 简化谱：书面节奏按十六分音符整理；发声、跟随和选段使用原演奏时序。复杂节奏与分手可用 DuET 制谱。"
            } else if variant.durations {
                "按当前量化演奏重新记谱；谱表按音区分配"
            } else {
                "按当前量化起点重新记谱，书面时值取至 1/128；演奏仍使用原始时值"
            }]);
            for key in [
                "trillCount",
                "mordentCount",
                "turnCount",
                "invertedTurnCount",
            ] {
                payload[key] = serde_json::json!(0);
            }
            let visits:Vec<_>=file.musical_time.measures.iter().enumerate().filter_map(|(index,m)|{
                let start=file.tempo_track.pulses_to_duration(m.start_tick).as_secs_f64();
                let end=file.tempo_track.pulses_to_duration(m.end_tick).min(file.duration).as_secs_f64();
                (end>start).then(||serde_json::json!({"ordinal":index,"measure":index,"number":m.display_number.to_string(),"pass":1,"start":start,"end":end,"startBeat":1,"endBeat":1.+(m.end_tick-m.start_tick) as f64/f64::from(file.tempo_track.ppq())*f64::from(m.denominator)/4.,"partialStart":false,"partialEnd":false}))
            }).collect();
            payload["route"] = serde_json::json!({"complete":true,"visits":visits});
        } else if variant.transpose != 0 {
            payload["bytes"] = serde_json::json!(panthesia_core::practice_score::transpose(
                &self.notation.as_ref().ok_or("尚未配对乐谱")?.bytes,
                variant.transpose
            )?);
            payload["compressed"] = serde_json::json!(false);
        } else if let Some(asset) = self.notation.as_ref() {
            payload["bytes"] = serde_json::json!(asset.bytes);
        }
        if let Some(file) = &self.file {
            payload["contentId"] = serde_json::json!(file.content_id);
            payload["scoreRevision"] = serde_json::json!(self.score_revision);
        }
        Ok(payload)
    }
}

/// Key estimation belongs to detached score preparation, never the driver capture.
pub(super) fn key_for(file: &MidiFile, variant: &crate::practice_variant::Variant) -> (i8, bool) {
    let signature = file.key_signature;
    let estimated = if signature.is_none() && (variant.tonic.is_none() || variant.minor.is_none()) {
        crate::practice_variant::key_estimate(file)
    } else {
        (0, false)
    };
    let minor = variant
        .minor
        .or(signature.map(|(_, minor)| minor))
        .unwrap_or(estimated.1);
    let tonic = variant
        .tonic
        .or(signature.map(|(fifths, minor)| {
            ((i16::from(fifths) * 7 + if minor { 9 } else { 0 }).rem_euclid(12)) as u8
        }))
        .unwrap_or(estimated.0);
    let tonic = (i16::from(tonic) + i16::from(variant.transpose)).rem_euclid(12);
    let fifths=signature.filter(|(_,m)|*m==minor).map(|(f,_)|f).filter(|f|(i16::from(*f)*7+if minor{9}else{0}).rem_euclid(12)==tonic).unwrap_or_else(||(-7i8..=7).filter(|f|(i16::from(*f)*7+if minor{9}else{0}).rem_euclid(12)==tonic).min_by_key(|f|f.abs()).unwrap_or(0));
    (fifths, minor)
}
