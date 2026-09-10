// Open conversation: the reusable, validated state for free-form replies.
//
// A harmless exchange runs entirely inside this story. It declares no EXTERNAL
// functions at all, so there is no action reference to leave unresolved and
// nothing here can dispatch anything.

VAR config_dialogue_language = "en"
VAR config_accessibility_reducedMotion = false

-> listening

=== listening ===
// Deliberately silent. The host supplies the reply text for this state; the
// story exists to hold a validated position in the conversation, not to write
// dialogue that the personality layer already owns.
-> DONE

=== waiting_on_capability ===
That part is still being built. I will pick this up when it exists.
-> DONE

=== unavailable ===
That is not available here, and I am not going to pretend otherwise.
-> DONE
