# Shared goals

Say or type “work together” to open the floating shared-goal panel. Create an invite or discover publicly listed goals. Review the goal and explicitly join before proposing work. Accepting a proposed task runs the local harness and shares its result.

Private invitations keep the encryption key in the URL fragment. Messages use AES-GCM encryption and P-256 signatures. Public listing deliberately publishes the invitation and goal, allowing anyone to join and read shared plans and results. Listings expire after 24 hours; the creator can remove them sooner. Existing invite holders retain access until the room expires.

Cloudflare Durable Objects relay bounded messages and maintain the public directory. Cooperation requires connectivity. One local model handles bounded planning and specialist work. Saved personal details and files are not attached automatically. Participants see shared results, so review the task before accepting it. Leaving disconnects communication; already accepted local work may continue.

This is an initial collaboration protocol, not a trained negotiation policy or a guarantee that independent goals align. Local acceptance remains explicit.
