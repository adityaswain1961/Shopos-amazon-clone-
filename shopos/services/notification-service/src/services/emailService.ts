import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || 're_mock_123');

export const sendEmail = async (to: string, subject: string, html: string) => {
  try {
    if (process.env.NODE_ENV === 'development' || !process.env.RESEND_API_KEY) {
      console.log(`[Mock Email] To: ${to} | Subject: ${subject}`);
      console.log(`[Mock Email] Body: ${html}`);
      return { id: 'mock-id' };
    }

    const data = await resend.emails.send({
      from: 'ShopOS <noreply@shopos.com>',
      to: [to],
      subject,
      html,
    });

    console.log('Email sent:', data);
    return data;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};
