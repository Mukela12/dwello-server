import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.EMAIL_FROM || 'contact@fluxium.dev';
const APP_NAME = 'MwiniPay';

export async function sendTenantInvite(email: string, landlordName: string, propertyName: string, unitName: string, inviteToken: string) {
  const inviteUrl = `${process.env.FRONTEND_URL}/register?invite=${inviteToken}`;

  await resend.emails.send({
    from: `${APP_NAME} <${FROM}>`,
    to: email,
    subject: `You've been invited to ${propertyName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to ${APP_NAME}</h2>
        <p>${landlordName} has invited you to join <strong>${propertyName} - ${unitName}</strong> as a tenant.</p>
        <p>Click the button below to create your account and get started:</p>
        <a href="${inviteUrl}" style="display: inline-block; padding: 12px 24px; background: #2563EB; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Accept Invitation</a>
        <p style="color: #666; font-size: 14px;">This invitation expires in 7 days.</p>
      </div>
    `,
  });
}

export async function sendPaymentReceipt(email: string, tenantName: string, amount: number, propertyName: string, unitName: string, month: string) {
  await resend.emails.send({
    from: `${APP_NAME} <${FROM}>`,
    to: email,
    subject: `Payment Receipt - ${month}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Payment Receipt</h2>
        <p>Hi ${tenantName},</p>
        <p>Your rent payment has been received:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Property</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${propertyName} - ${unitName}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Amount</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">ZMW ${amount.toLocaleString()}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Period</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${month}</td></tr>
        </table>
        <p style="color: #10B981;">Thank you for your payment!</p>
      </div>
    `,
  });
}

export async function sendRentReminder(email: string, tenantName: string, amount: number, propertyName: string, unitName: string, dueDate: string) {
  await resend.emails.send({
    from: `${APP_NAME} <${FROM}>`,
    to: email,
    subject: `Rent Reminder - ${propertyName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Rent Reminder</h2>
        <p>Hi ${tenantName},</p>
        <p>This is a reminder that your rent payment of <strong>ZMW ${amount.toLocaleString()}</strong> for <strong>${propertyName} - ${unitName}</strong> is due on <strong>${dueDate}</strong>.</p>
        <a href="${process.env.FRONTEND_URL}/tenant/payments" style="display: inline-block; padding: 12px 24px; background: #2563EB; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Pay Now</a>
      </div>
    `,
  });
}

export async function sendPasswordReset(email: string, name: string, resetToken: string) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  await resend.emails.send({
    from: `${APP_NAME} <${FROM}>`,
    to: email,
    subject: 'Reset Your Password',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset</h2>
        <p>Hi ${name},</p>
        <p>You requested a password reset. Click the button below to set a new password:</p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #2563EB; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Reset Password</a>
        <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}
