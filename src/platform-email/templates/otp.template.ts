export const otpEmailTemplate = (
  otp: string,
  expiresInMinutes: number = 10,
): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email - NotifyKit</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          background-color: #f5f5f5;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #ffffff;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .header {
          background-color: #000000;
          padding: 32px 24px;
          text-align: center;
        }
        .logo {
          color: #ffffff;
          font-size: 24px;
          font-weight: bold;
          margin: 0;
        }
        .content {
          padding: 40px 24px;
        }
        .title {
          font-size: 24px;
          font-weight: bold;
          color: #000000;
          margin: 0 0 16px 0;
        }
        .text {
          font-size: 16px;
          color: #666666;
          line-height: 1.6;
          margin: 0 0 24px 0;
        }
        .otp-box {
          background-color: #f5f5f5;
          border: 2px solid #000000;
          border-radius: 8px;
          padding: 24px;
          text-align: center;
          margin: 32px 0;
        }
        .otp-code {
          font-size: 36px;
          font-weight: bold;
          color: #000000;
          letter-spacing: 8px;
          margin: 0;
        }
        .expiry {
          font-size: 14px;
          color: #999999;
          margin: 12px 0 0 0;
        }
        .footer {
          background-color: #f5f5f5;
          padding: 24px;
          text-align: center;
          font-size: 14px;
          color: #999999;
        }
        .footer a {
          color: #000000;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="logo">NotifyKit</h1>
        </div>
        
        <div class="content">
          <h2 class="title">Verify Your Email</h2>
          <p class="text">
            Thank you for signing up with NotifyKit! To complete your registration, 
            please use the verification code below:
          </p>
          
          <div class="otp-box">
            <p class="otp-code">${otp}</p>
            <p class="expiry">This code expires in ${expiresInMinutes} minutes</p>
          </div>
          
          <p class="text">
            If you didn't create an account with NotifyKit, you can safely ignore this email.
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
