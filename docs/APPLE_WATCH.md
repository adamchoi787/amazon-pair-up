# PairUp on Apple Watch

In the web app, sign in and open **Devices → Apple Watch → Create token**.
Copy the token and Shortcut steps before leaving the panel. Revoke a lost device
from the same panel. A token can call the voice and context endpoints.

Create a Shortcut on the paired iPhone:

1. Add **Dictate Text**.
2. Add **Get Contents of URL**, using your server's HTTPS `/api/voice` URL.
   Choose POST, add `Authorization: Bearer apd_…`, and use a JSON request body:
   `text` = Dictated Text, `time_zone` = `America/Los_Angeles` (or your IANA time zone).
3. Add **Get Dictionary Value**, key `say`, from the response.
4. Add **Speak Text**, using that value.
5. Name the Shortcut **PairUp** and enable **Show on Apple Watch**.

Say “Hey Siri, PairUp”, then “anything I need?” or a marketplace request.
Run it again and say “yes” to accept the suggestion just spoken. Conversation
history lasts ten minutes. A proposed deal still needs the user's explicit yes.
Keep the token in your private Shortcut; create separate tokens for each device.

For an arrival automation on iPhone, use **When I arrive at a place** and POST
to `/api/context` with the same authorization header and JSON:

```json
{"source":"phone","kind":"location","place":"McCarty Hall","time_zone":"America/Los_Angeles"}
```

Show the returned `say` as a notification when it is nonempty. Location stores a
place name and can make a learned routine relevant. Accept the suggestion in
PairUp or through the voice Shortcut.

The `/watch/` browser view shares your web sign-in. It shows a waiting deal or the
top suggestion, Yes/No buttons, speech input where supported, and typed input.
On desktop it appears in a watch frame for recording. This browser preview and
the Siri Shortcut can be tested separately; physical Watch behavior needs a
paired Apple Watch and an HTTPS server.
