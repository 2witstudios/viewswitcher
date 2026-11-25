// POST /api/ipad-beta: the iPad beta signup (SITE-27). A Vercel Function (Node runtime, web-standard
// fetch handler); Vercel deploys every file in this folder as one, alongside the static build in dist/.
// The logic and its tests are in src/lib/ipad-beta.ts. Needs RESEND_API_KEY and RESEND_AUDIENCE_ID
// (README.md, "iPad beta signup"); without them it answers 503, "Sign-ups aren't open yet".
import { handleBeta } from "../src/lib/ipad-beta";

export default {
  fetch(request: Request): Promise<Response> {
    return handleBeta(request, { RESEND_API_KEY: process.env.RESEND_API_KEY, RESEND_AUDIENCE_ID: process.env.RESEND_AUDIENCE_ID });
  },
};
