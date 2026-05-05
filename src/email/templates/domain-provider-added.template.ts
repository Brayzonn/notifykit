interface DnsRecordRow {
  type: string;
  host: string;
  value: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  SENDGRID: 'SendGrid',
  RESEND: 'Resend',
  POSTMARK: 'Postmark',
};

export const domainProviderAddedTemplate = (
  name: string,
  domain: string,
  provider: string,
  dnsRecords: DnsRecordRow[],
): string => {
  const providerLabel = PROVIDER_LABELS[provider] ?? provider;
  const recordsHtml = dnsRecords
    .map(
      (r) => `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e5e5; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; color: #000000; vertical-align: top;">${r.type}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e5e5; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; color: #000000; vertical-align: top; word-break: break-all;">${r.host}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e5e5; font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; color: #000000; vertical-align: top; word-break: break-all;">${r.value}</td>
        </tr>`,
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>DNS records needed for ${providerLabel}</title>
      <style>
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .header { background-color: #000000; padding: 32px 24px; text-align: center; }
        .logo { color: #ffffff; font-size: 24px; font-weight: bold; margin: 0; }
        .content { padding: 40px 24px; }
        .title { font-size: 22px; font-weight: bold; color: #000000; margin: 0 0 16px 0; }
        .text { font-size: 16px; color: #444444; line-height: 1.6; margin: 0 0 16px 0; }
        .button { display: inline-block; background-color: #000000; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 24px 0; }
        .table-wrap { border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden; margin: 24px 0; }
        table { width: 100%; border-collapse: collapse; }
        th { padding: 10px 12px; background-color: #f5f5f5; text-align: left; font-size: 12px; font-weight: 600; color: #555555; border-bottom: 1px solid #e5e5e5; }
        .footer { background-color: #f5f5f5; padding: 24px; text-align: center; font-size: 14px; color: #999999; }
        .footer a { color: #000000; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="logo">NotifyKit</h1>
        </div>

        <div class="content">
          <h2 class="title">Action needed: publish DNS records for ${providerLabel}</h2>

          <p class="text">Hi ${name},</p>

          <p class="text">
            You added <strong>${providerLabel}</strong> to your account, and we
            registered your domain <strong>${domain}</strong> with it
            automatically. Until the DNS records below are published, emails
            sent through ${providerLabel} from <strong>${domain}</strong> will
            fail.
          </p>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style="width: 80px;">Type</th>
                  <th>Host</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                ${recordsHtml}
              </tbody>
            </table>
          </div>

          <p class="text">
            Add these to your domain registrar's DNS settings (Namecheap,
            Cloudflare, GoDaddy, etc.). DNS propagation usually takes 15–60
            minutes. Once published, click <strong>Verify Domain</strong> on
            your domains page.
          </p>

          <div style="text-align: center;">
            <a href="https://notifykit.dev/user/dashboard/domains" class="button">
              Open Domains Page
            </a>
          </div>

          <p class="text">
            Didn't add ${providerLabel} or recognize this change? Remove the
            provider from your dashboard and contact support.
          </p>
        </div>

        <div class="footer">
          <p>© ${new Date().getFullYear()} NotifyKit. All rights reserved.</p>
          <p>
            <a href="https://notifykit.dev">Website</a> |
            <a href="https://docs.notifykit.dev">Documentation</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};
