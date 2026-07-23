/**
 * Full-viewport loading state — the same one the Polluxa CRM shows (src/components/Loading.jsx:
 * a centered 90×90 /loader.gif). Used while auth/session resolves and during the CRM→app SSO
 * hand-off, so the transition between the two products looks identical. The gif asset was copied
 * from the CRM's public/loader.gif.
 */
export default function FullPageLoader() {
  return (
    <div className="full-page-loader">
      <img src="/loader.gif" width={90} height={90} alt="Loading" />
    </div>
  );
}
