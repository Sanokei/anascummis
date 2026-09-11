// Show and tell: putting something on screen instead of into the reply.
//
// A reply is read once, in order, and is behind you when it is done. A window
// stays. That difference is the reason these functions exist at all, and it is
// why the runtime answers them inline rather than dispatching them: raising a
// window is a decision the host makes about its own screen, from data the turn
// already holds. There is no work in it for a permission, a budget, or a
// confirmation to protect.
//
// All four map to presentational capabilities with no permissions and no side
// effects. A story that wants to fetch, write, or spend calls something else
// and yields to the host — a different mechanism, with a different gate in
// front of it, and the distinction is the whole safety argument.
//
// The costume is the other half of the same idea. It is not a mood the story
// reports; the reply carries mood. It is what the shell wears while the window
// is up, and it comes off by itself when its time is out, which is why taking
// it off and putting it on are two functions rather than one.

EXTERNAL surface_window(id, title, body, emphasis)
EXTERNAL surface_close(id, reason)
EXTERNAL persona_wear(id, reason, bit)
EXTERNAL persona_clear()

VAR window_id = ""
VAR dressed = false

-> start

=== start ===
// The id is the whole identity of the window. This call opens it the first
// time and updates the same one after that, so a story that runs twice leaves
// one window on screen rather than two.
~ window_id = surface_window("show-and-tell", "Show and tell", "A reply is read once and is gone. This is the other thing: it appears beside the reply and stays until something takes it down.", "normal")
It is beside this, not in it.
-> offer

=== offer ===
+ Say what it is for # action: none
    -> remark
+ {not dressed} Wear the archivist while it is up # action: none
    -> dress
+ {dressed} Take the costume off # action: none
    -> undress
+ Take the window down # action: none
    -> take_down

=== remark ===
A demonstration, so it demonstrates itself.
-> offer

=== dress ===
// The costume carries its own duration, so nothing here decides how long. The
// reason is not decoration: the interface shows it, and an empty one reads as
// a bug rather than as restraint.
~ dressed = true
~ persona_wear("archivist", "a window full of documents deserves one", "filed")
-> offer

=== undress ===
~ dressed = false
~ persona_clear()
-> offer

=== take_down ===
// Callable as a statement. Every one of these externals answers with a string —
// the id on success, a sentence beginning "error:" on a refusal — so a story
// that needed to know whether it worked can assign the answer and test it. This
// one has already decided the close is worth trying, so it does not ask.
~ surface_close(window_id, "shown")
It is down.
-> DONE
