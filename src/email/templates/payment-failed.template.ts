export const paymentFailedEmailTemplate = (
  name: string,
  plan: string,
  amount: number,
  retryDate: Date | null,
): string => {
  const retryDateStr = retryDate
    ? new Date(retryDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'soon';

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
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">⚠️ Payment Failed</h1>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 40px;">
                  <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.5;">
                    Hi ${name},
                  </p>
                  
                  <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.5;">
                    We weren't able to process your payment for your <strong>${plan}</strong> plan subscription ($${amount.toFixed(2)}).
                  </p>
                  
                  <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px;">
                    <p style="margin: 0; color: #856404; font-size: 14px;">
                      <strong>What happens next?</strong><br>
                      We'll automatically retry the payment ${retryDate ? `on ${retryDateStr}` : 'soon'}. Please ensure your payment method has sufficient funds.
                    </p>
                  </div>
                  
                  <p style="margin: 0 0 20px; color: #333333; font-size: 16px; line-height: 1.5;">
                    <strong>To update your payment method:</strong>
                  </p>
                  
                  <ol style="margin: 0 0 20px; padding-left: 20px; color: #333333; font-size: 16px; line-height: 1.8;">
                    <li>Log in to your NotifyHub dashboard</li>
                    <li>Go to Billing settings</li>
                    <li>Update your payment method</li>
                  </ol>
                  
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL || 'https://notifyhub.com'}/dashboard/billing" 
                       style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
                      Update Payment Method
                    </a>
                  </div>
                  
                  <p style="margin: 20px 0 0; color: #666666; font-size: 14px; line-height: 1.5;">
                    If we're unable to process your payment after multiple attempts, your subscription may be cancelled and your account will be downgraded to the FREE plan.
                  </p>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                  <p style="margin: 0 0 10px; color: #666666; font-size: 14px;">
                    Need help? Contact us at <a href="mailto:support@notifyhub.com" style="color: #667eea; text-decoration: none;">support@notifyhub.com</a>
                  </p>
                  <p style="margin: 0; color: #999999; font-size: 12px;">
                    © ${new Date().getFullYear()} NotifyHub. All rights reserved.
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
