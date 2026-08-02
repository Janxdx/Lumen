/* Sending the one email this app sends.

   Workers have no SMTP, so delivery goes through Resend's HTTP API. This is
   the single piece of the stack that isn't yours: everything else runs on
   your Cloudflare account, but somebody has to have a reputation with the
   receiving mail servers, and that cannot be self-hosted into existence.

   With no API key configured — local development — the link is written to
   the console instead. That keeps `wrangler dev` usable offline and means
   you never need a verified sending domain just to try a sign-in. */

import type { Env } from './env';

export async function sendLoginLink(
  env: Env,
  email: string,
  link: string
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`\n  ✉  sign-in link for ${email}\n     ${link}\n`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: email,
      subject: 'Your Lumen sign-in link',
      text: `Open this link to sign in to Lumen:\n\n${link}\n\nIt works once and expires in 15 minutes. If you didn't ask for it, nothing has happened to your account — ignore this message.`,
      html: html(link),
    }),
  });

  if (!res.ok) {
    /* Log the provider's reason, tell the caller nothing. A failure here is
       usually an unverified sending domain or a spent quota, and neither is
       any of the visitor's business. */
    console.error('resend failed', res.status, await res.text().catch(() => ''));
    throw new Error('Could not send the email just now.');
  }
}

const html = (link: string): string => `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f6f4f1;font-family:ui-sans-serif,-apple-system,Segoe UI,sans-serif;color:#2a2724">
    <div style="max-width:440px;margin:0 auto;background:#fffdfa;border:1px solid #e8e2d9;border-radius:16px;padding:32px">
      <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a8178">Lumen</div>
      <h1 style="font-size:22px;font-weight:600;letter-spacing:-.02em;margin:12px 0 8px">Sign in</h1>
      <p style="font-size:15px;line-height:1.5;color:#5c554d;margin:0 0 24px">
        Open the link below and you're in. It works once and expires in 15 minutes.
      </p>
      <a href="${link}" style="display:inline-block;background:#2a2724;color:#fffdfa;text-decoration:none;font-size:15px;font-weight:500;padding:12px 22px;border-radius:10px">Open Lumen</a>
      <p style="font-size:13px;line-height:1.5;color:#8a8178;margin:24px 0 0">
        If you didn't ask for this, nothing has happened to your account and you can ignore it.
      </p>
    </div>
  </body>
</html>`;
