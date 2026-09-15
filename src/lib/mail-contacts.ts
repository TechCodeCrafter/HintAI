import config from "../../config/mail-contacts.json";

/** Do not set true in repo until DNS + mailbox delivery are verified (Phase B ops). */
export const MEETHINT_MAIL_CONTACTS_VERIFIED = config.verified === true;

export const MEETHINT_SECURITY_EMAIL = config.securityEmail;
export const MEETHINT_ABUSE_EMAIL = config.abuseEmail;
export const MEETHINT_SUPPORT_EMAIL = config.supportEmail;
export const MEETHINT_HELLO_EMAIL = config.helloEmail;

export const MEETHINT_MAIL_PROVIDER = config.mailProvider;

export { config as mailContactsConfig };
