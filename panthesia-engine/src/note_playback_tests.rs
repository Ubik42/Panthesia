use super::*;

#[test]
fn reference_audio_policy_keeps_background_playing_and_discard_silent_in_every_mode() {
    for mode in ["listen", "flow", "wait", "rhythm", "recital", "memory"] {
        assert!(reference_sounds(PlayerConfig::Auto, mode));
        assert!(!reference_sounds(PlayerConfig::Mute, mode));
        assert_eq!(
            reference_sounds(PlayerConfig::Human, mode),
            matches!(mode, "listen" | "flow")
        );
    }
}
