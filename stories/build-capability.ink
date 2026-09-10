// Building a missing capability.
//
// This story deliberately declares no EXTERNAL for the Forge. Proposing a
// capability is a host decision, not a story action, and the fragment that
// depends on the new capability stays unpublished until it exists and passes
// revalidation. This one only carries the conversation while that happens.

VAR capability_name = ""

-> propose

=== propose ===
{capability_name == "": -> nothing_proposed}
There is no function for that yet. I can build one, or work around it.
+ Build it # action: none
    -> building
+ Work around it instead # action: none
    -> workaround
+ Leave it # action: none
    -> left

=== nothing_proposed ===
Nothing has been proposed to build.
-> DONE

=== building ===
// A waiting fragment. It is separately validated and it executes nothing.
Building it now. I will tell you whether it worked, either way.
-> DONE

=== workaround ===
Then I will use what is already installed.
-> DONE

=== left ===
Left alone.
-> DONE
