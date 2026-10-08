import { clock } from '../format';

export interface AuditItem {
  id: string;
  eventType: string;
  summary: string;
  detailJson: string;
  createdAt: string;
}

/** Colour groups the event types by stage of the workflow. Colour is never the only cue: the label is always printed. */
const GROUP: Record<string, 'telemetry' | 'model' | 'risk' | 'market' | 'alert' | 'system'> = {
  TELEMETRY_RECEIVED: 'telemetry',
  SHELF_LIFE_RECALCULATED: 'model',
  RISK_ESCALATED: 'risk',
  LIQUIDATION_RECOMMENDED: 'risk',
  MARKETPLACE_UPDATED: 'market',
  RETAILER_ALERT_GENERATED: 'alert',
  SHIPMENT_INITIALIZED: 'system',
  LISTING_CLAIMED: 'market',
  RETAILER_ACKNOWLEDGED: 'alert',
};

const ICON: Record<string, string> = {
  TELEMETRY_RECEIVED: '📡',
  SHELF_LIFE_RECALCULATED: '⏳',
  RISK_ESCALATED: '⚠',
  LIQUIDATION_RECOMMENDED: '🏷',
  MARKETPLACE_UPDATED: '🛒',
  RETAILER_ALERT_GENERATED: '🔔',
  SHIPMENT_INITIALIZED: '🚚',
  LISTING_CLAIMED: '✅',
  RETAILER_ACKNOWLEDGED: '👍',
};

const label = (type: string) => type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Oldest first, so the timeline reads in the order the backend acted. */
export function AuditTimeline({ entries, fresh }: { entries: AuditItem[]; fresh: Set<string> }) {
  const ordered = [...entries].reverse();
  if (ordered.length === 0) {
    return <p className="quiet">No operational events recorded yet.</p>;
  }
  return (
    <ol className="op-timeline" aria-label="Operational event timeline">
      {ordered.map((e) => {
        const group = GROUP[e.eventType] ?? 'system';
        return (
          <li key={e.id} className={`op-item group-${group} ${fresh.has(e.id) ? 'is-new' : ''}`}>
            <span className="op-node" aria-hidden="true">{ICON[e.eventType] ?? '•'}</span>
            <div className="op-body">
              <div className="op-head">
                <span className="op-type">{label(e.eventType)}</span>
                <time dateTime={e.createdAt}>{clock(e.createdAt)}</time>
              </div>
              <p className="op-summary">{e.summary}</p>
              <details className="op-detail">
                <summary aria-label="Show details">{'{ }'}</summary>
                <pre>{JSON.stringify(JSON.parse(e.detailJson), null, 2)}</pre>
              </details>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
