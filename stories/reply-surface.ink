// Reply surface: the visible half of a conversational turn.
//
// The conversational story holds the position; this surface produces the text.
// It is compiled with the rest of the story set, so it is covered by the same
// harness — a story that cannot compile never reaches a turn, and it declares
// no EXTERNAL functions, so nothing here can dispatch anything.
//
// The contract with the host is prefix-stability: the reply is emitted
// verbatim, and it is emitted first. Whatever this surface adds comes after
// it, because the host has already streamed the reply to the client by the
// time the surface runs, and text that has been seen cannot be rewritten.

VAR reply = ""
VAR closing = false

-> render

=== render ===
{closing: -> silence}
// No glue character in front of the expression. Ink's glue is `<>`, so a `^`
// here would be literal text and every reply would begin with one.
{reply}
-> DONE

=== silence ===
// The closing beat. After this line the cut is clean: no acknowledgement, no
// follow-up question, no summary. Silence is the whole reply.
-> DONE
