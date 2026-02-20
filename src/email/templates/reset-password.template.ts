export const resetPasswordEmailTemplate = (
  otp: string,
  expiresInMinutes: number = 10,
): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your Password - NotifyKit</title>
      <style>
        /* same styles as otpEmailTemplate */
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="logo">NotifyKit</h1>
        </div>
        <div class="content">
          <h2 class="title">Reset Your Password</h2>
          <p class="text">
            We received a request to reset your password. Use the code below to complete the reset.
          </p>
          <div class="otp-box">
            <p class="otp-code">${otp}</p>
            <p class="expiry">This code expires in ${expiresInMinutes} minutes</p>
          </div>
          <p class="text">
            If you didn't request a password reset, you can safely ignore this email.
          </p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} NotifyKit. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};
