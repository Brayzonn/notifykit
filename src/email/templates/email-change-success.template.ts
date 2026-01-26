export const emailChangeSuccessTemplate = (newEmail: string): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Email Updated Successfully</title>
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
          font-size: 18px;
        }
        .warning {
          background-color: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 16px;
          margin: 24px 0;
          border-radius: 4px;
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
          <h1 class="logo">NotifyHub</h1>
        </div>
        
        <div class="content">
          <h2 class="title">Email Updated Successfully</h2>
          
          <div class="success">
            <strong>✓ Your email has been successfully changed!</strong>
          </div>
          
          <p class="text">Your new login email is:</p>
          
          <div class="email-box">
            <strong>${newEmail}</strong>
          </div>
          
          <p class="text">
            Use this email address for all future logins to NotifyHub.
          </p>
          
          <div class="warning">
            <strong> Security Notice:</strong> If you didn't make this change, 
            contact support immediately at <strong>support@notifyhub.com</strong>
          </div>
        </div>
        
        <div class="footer">
          <p>© ${new Date().getFullYear()} NotifyHub. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};
