import {
  MEETHINT_ABUSE_EMAIL,
  MEETHINT_MAIL_CONTACTS_VERIFIED,
  MEETHINT_SECURITY_EMAIL,
  MEETHINT_SUPPORT_EMAIL,
} from "@/lib/mail-contacts";
import { MEETHINT_REPO, MEETHINT_SECURITY_CONTACT, MEETHINT_SUPPORT_CONTACT } from "@/lib/brand";

/** Security reporting block — GitHub always; mail only after Phase B verification. */
export function TrustSecurityContacts() {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Security reporting</h2>
      {MEETHINT_MAIL_CONTACTS_VERIFIED ? (
        <>
          <p>
            Email:{" "}
            <a href={`mailto:${MEETHINT_SECURITY_EMAIL}`}>{MEETHINT_SECURITY_EMAIL}</a>
          </p>
          <p>
            Or use{" "}
            <a href={MEETHINT_SECURITY_CONTACT}>GitHub Security Advisories</a> on{" "}
            <a href={MEETHINT_REPO}>{MEETHINT_REPO.replace("https://", "")}</a>.
          </p>
        </>
      ) : (
        <>
          <p>
            Report vulnerabilities via{" "}
            <a href={MEETHINT_SECURITY_CONTACT}>GitHub Security Advisories</a> on{" "}
            <a href={MEETHINT_REPO}>{MEETHINT_REPO.replace("https://", "")}</a>.
          </p>
          <p className="text-[var(--hint-muted)]">
            Dedicated <code>{MEETHINT_SECURITY_EMAIL}</code> mail activates after Namecheap forward +
            inbound delivery verification (Phase B).
          </p>
        </>
      )}
    </section>
  );
}

export function TrustAbuseContacts() {
  if (!MEETHINT_MAIL_CONTACTS_VERIFIED) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Abuse</h2>
      <p>
        Email: <a href={`mailto:${MEETHINT_ABUSE_EMAIL}`}>{MEETHINT_ABUSE_EMAIL}</a>
      </p>
    </section>
  );
}

export function TrustProductContacts() {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Product questions</h2>
      <p>
        Open a <a href={MEETHINT_SUPPORT_CONTACT}>GitHub issue</a> for product questions
        {MEETHINT_MAIL_CONTACTS_VERIFIED ? (
          <>
            {" "}
            or email <a href={`mailto:${MEETHINT_SUPPORT_EMAIL}`}>{MEETHINT_SUPPORT_EMAIL}</a>.
          </>
        ) : (
          "."
        )}
      </p>
    </section>
  );
}
