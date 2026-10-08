import type { SettlementModalData } from "@/app/_types/settlement";

type Props = {
  data: SettlementModalData | null;
  isLoading?: boolean;
  walletAddress: string | null;
};

export default function RaffleSettlementInfo({ data, isLoading = false, walletAddress }: Props) {
  return (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">{data?.campaignTitle ?? "Raffle settlement"}</p>
      <p className="mt-3 text-gray-900 font-semibold">Evidence:</p>
      {isLoading ? (
        <div className="create-info-skeleton-list" aria-hidden="true">
          <span className="create-info-skeleton-line" />
          <span className="create-info-skeleton-line" />
          <span className="create-info-skeleton-line" />
        </div>
      ) : (
        <>
          <table className="create-info-settlement-evidence-table text-gray-500">
            <tbody>
              {(data?.evidenceItems ?? []).map((item, index) => {
                const separatorIndex = item.indexOf(": ");
                const key = separatorIndex === -1 ? item : item.slice(0, separatorIndex);
                const value = separatorIndex === -1 ? "" : item.slice(separatorIndex + 2);

                return (
                  <tr key={item} className="create-info-settlement-evidence-row create-info-typed-line"
                    style={{ animationDelay: `${index * 90}ms` }}>
                    <td className="create-info-settlement-evidence-key">{value ? `${key}:` : key}</td>
                    <td className="create-info-settlement-evidence-value">{value}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-gray-900 font-semibold">Recipients:</p>
          {(data?.recipients ?? []).length > 0 ? (
            (data?.recipients ?? []).map((recipient, index) => {
              const isConnectedRecipient = walletAddress?.trim().toLowerCase() === recipient.address.trim().toLowerCase();

              return (
                <div key={`${recipient.address}-${index}`}
                  className={`create-info-constraint-item create-info-settlement-recipient-row font-mono create-info-typed-line ${isConnectedRecipient ? "create-info-settlement-recipient-current" : "text-gray-500"}`}
                  style={{ animationDelay: `${((data?.evidenceItems ?? []).length + index) * 90}ms` }}>
                  <span className="create-info-settlement-recipient-handle">
                    {recipient.handle}
                    {isConnectedRecipient ? <span className="create-info-settlement-recipient-you"> (You)</span> : null}
                  </span>
                  <span className="create-info-settlement-recipient-amount">{recipient.amountLabel}</span>
                </div>
              );
            })
          ) : (
            <p className="create-info-constraint-item text-gray-500"><span>No recipients found.</span></p>
          )}
          {data?.errorMessage ? (
            <>
              <p className="mt-3 text-red-500 font-semibold">Errors:</p>
              <p className="create-info-constraint-item text-red-500 break-words"><span>{data.errorMessage}</span></p>
            </>
          ) : null}
        </>
      )}
      {data?.distributionTxHash ? (
        <>
          <p className="mt-3 text-gray-900 font-semibold">Distribution tx:</p>
          <p className="create-info-constraint-item text-gray-500 font-mono break-all">
            <a href={`https://pudge.explorer.nervos.org/transaction/${data.distributionTxHash}`}
              target="_blank" rel="noopener noreferrer" className="underline">{data.distributionTxHash}</a>
          </p>
        </>
      ) : null}
    </div>
  );
}
