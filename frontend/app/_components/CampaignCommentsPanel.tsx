"use client";

type CampaignComment = {
  text: string;
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  createdAt?: string;
};

type CampaignCommentsPanelProps = {
  comments: CampaignComment[];
  emptyMessage?: string;
  fallbackAddress?: string;
  title?: string;
};

function buildDefaultHandle(addressHex: string) {
  const normalized = addressHex.toLowerCase().replace(/^0x/, "");
  return `freight${normalized.slice(-20)}.ckb`;
}

export default function CampaignCommentsPanel({
  comments,
  emptyMessage = "No comments yet.",
  fallbackAddress = "0x0000000000000000000000000000000000000000",
  title = "Comments",
}: CampaignCommentsPanelProps) {
  return (
    <div className="campaign-detail-comments-card">
      <div className="campaign-detail-comments-header">
        <h2 className="campaign-detail-comments-title">{title}</h2>
        <span className="campaign-detail-comments-count">{comments.length}</span>
      </div>
      {comments.length > 0 ? (
        <div className="campaign-detail-comments-list">
          {comments.map((comment, index) => (
            <article key={`${comment.createdAt ?? "comment"}-${index}`} className="campaign-detail-comment-item">
              <div className="campaign-detail-comment-meta">
                <span className="campaign-detail-comment-author">{comment.creatorHandle ?? buildDefaultHandle(comment.creatorAddress ?? fallbackAddress)}</span>
                {comment.createdAt ? <span className="campaign-detail-comment-date">{new Date(comment.createdAt).toLocaleString()}</span> : null}
              </div>
              <p className="campaign-detail-comment-text">{comment.text}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="campaign-detail-comments-empty">{emptyMessage}</p>
      )}
    </div>
  );
}
