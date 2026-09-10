// Research: search, then optionally read one of the results.
//
// Both actions are declared EXTERNAL and both map to installed capabilities,
// so the harness can enumerate them statically. Neither branch can be reached
// without the host validating and dispatching the call first.

EXTERNAL web_search(query)
EXTERNAL web_fetch(url)

VAR topic = ""
VAR findings = ""
VAR source_url = ""

-> start

=== start ===
{topic == "": -> nothing_to_look_up}
~ findings = web_search(topic)
I found sources for that.
-> offer_depth

=== nothing_to_look_up ===
There is nothing to look up yet.
-> DONE

=== offer_depth ===
+ Read the first source properly # action: web.fetch
    -> read_source
+ The summary is enough # action: none
    -> done
+ Search for something else # action: none
    -> start

=== read_source ===
{source_url == "": -> no_source}
~ findings = web_fetch(source_url)
-> done

=== no_source ===
None of those results gave me a usable link.
-> done

=== done ===
-> DONE
