export const planDowngradedEmailTemplate = (
  name: string,
  previousPlan: string,
  reason: 'SUBSCRIPTION_EXPIRED' | 'PAYMENT_FAILED',
  resetDate: Date,
): string => {
  const resetDateStr = new Date(resetDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const reasonText =
    reason === 'PAYMENT_FAILED'
      ? "we weren't able to process your payment after several attempts"
      : 'your subscription expired';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" style="padding: 40px 20px;">
            <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <!-- Header -->
              <tr>
                <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">Your plan has changed</h1>
                </td>
              </tr>

              <!-- Content -->
              <tr>
                <td style="padding: 40px;">
                  <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.5;">
                    Hi ${name},
                  </p>

                  <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.5;">
                    Because ${reasonText}, your <strong>${previousPlan}</strong> plan has been downgraded to the <strong>FREE</strong> plan.
                  </p>

                  <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
                    <p style="margin: 0; color: #856404; font-size: 14px;">
                      <strong>What this means for your account</strong><br>
                      You now have the FREE plan limits: 100 notifications per month, a 5 requests/minute rate limit, shared email infrastructure, and 14-day log retention. Your usage allowance resets on ${resetDateStr}.
                    </p>
                  </div>

                  <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.5;">
                    Want your higher limits back? You can reactivate a paid plan at any time:
                  </p>

                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL || 'https://notifykit.dev'}/dashboard/usage"
                       style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
                      Reactivate Your Plan
                    </a>
                  </div>

                  <p style="margin: 20px 0 0; color: #666666; font-size: 14px; line-height: 1.5;">
                    Your account, API keys, and historical data remain intact. Nothing has been deleted.
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                  <p style="margin: 0 0 10px; color: #666666; font-size: 14px;">
                    Need help? Contact us at <a href="mailto:support@notifykit.dev" style="color: #667eea; text-decoration: none;">support@notifykit.dev</a>
                  </p>
                  <p style="margin: 0; color: #999999; font-size: 12px;">
                    © ${new Date().getFullYear()} NotifyKit. All rights reserved.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};
