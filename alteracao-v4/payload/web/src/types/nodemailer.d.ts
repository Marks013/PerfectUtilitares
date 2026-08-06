declare module "nodemailer" {
  export type SentMessageInfo = { messageId?: string; accepted?: unknown[]; rejected?: unknown[] };
  export type Transporter = {
    sendMail(message: {
      from: { name: string; address: string };
      to: string[];
      subject: string;
      html: string;
    }): Promise<SentMessageInfo>;
  };
  const nodemailer: {
    createTransport(options: {
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
      connectionTimeout: number;
      greetingTimeout: number;
      socketTimeout: number;
      tls: { minVersion: "TLSv1.2"; rejectUnauthorized: true };
    }): Transporter;
  };
  export default nodemailer;
}
