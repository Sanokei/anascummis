/*
 * The two faces, and why these two.
 *
 * Plex is a superfamily, which is the whole reason for picking it. The product
 * has an unusual amount of *machine fact* in its prose — an authored line id, a
 * capability name, a risk tier, a citation's domain — and the old treatment set
 * those in the system monospace, which read as "here is a code snippet". Plex
 * Mono shares a skeleton with Plex Sans, so a fact stated in mono reads as the
 * same voice tightening rather than as a different medium interrupting. That is
 * the design idea: the assistant speaks in Plex Sans, and when it states
 * something it can be held to it switches register inside the same voice.
 *
 * It is also, frankly, not the obvious choice. Inter and Space Grotesk are what
 * a generated page reaches for; Plex was commissioned as an engineering face and
 * its slightly squared humanist letterforms read as instrument rather than as
 * consumer app, which is the register this product is written in.
 *
 * Self-hosted, so no third-party request on first paint. The app asks people to
 * accept a cookie policy before it will run analytics; pulling a display face
 * from someone else's CDN before that question is asked would contradict the
 * posture the rest of the app keeps. These are latin subsets only, and only the
 * weights the interface actually uses — a survey of the client found exactly one
 * `font-medium` and no italics, because hierarchy here is carried by hue, size
 * and form. Shipping 300 and 700 because a specimen sheet has them would be
 * bytes spent on nothing.
 */
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
