export const emailChangeCancelledTemplate = (
  oldEmail: string,
  newEmail: string,
): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Email Change Cancelled</title>
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
        .success {
          background-color: #d4edda;
          border-left: 4px solid #28a745;
          padding: 16px;
          margin: 24px 0;
          border-radius: 4px;
        }
        .email-box {
          background: #f5f5f5;
          padding: 16px;
          border-radius: 4px;
          margin: 16px 0;
          text-align: center;
        }
        .email-box strong {
          color: #000000;
          font-size: 16px;
        }
        .footer {
          background-color: #f5f5f5;
          padding: 24px;
          text-align: center;
          font-size: 14px;
          color: #999999;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="logo">NotifyKit</h1>
        </div>
        
        <div class="content">
          <h2 class="title">Email Change Cancelled</h2>
          
          <div class="success">
            <strong>✓ The email change request has been cancelled.</strong>
          </div>
          
          <p class="text">
            The request to change your email to <strong>${newEmail}</strong> has been cancelled.
          </p>
          
          <p class="text">Your email remains:</p>
          
          <div class="email-box">
            <strong>${oldEmail}</strong>
          </div>
          
          <p class="text">
            If you didn't cancel this request, please secure your account immediately 
            by changing your password.
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
