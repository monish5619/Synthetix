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
};

const DESCRIPTION: Record<string, string> = {
  TELEMETRY_RECEIVED: 'A reading was validated and stored',
  SHELF_LIFE_RECALCULATED: 'The degradation model produced a new snapshot',
  RISK_ESCALATED: 'The risk level moved up a band',
  LIQUIDATION_RECOMMENDED: 'The liquidation engine set a markdown',
  MARKETPLACE_UPDATED: 'The marketplace listing was repriced',
  RETAILER_ALERT_GENERATED: 'A spoilage alert was written for the retailer',
  SHIPMENT_INITIALIZED: 'The shipment was created at its baseline',
};

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
            <span className="op-node" aria-hidden="true" />
            <div className="op-body">
              <div className="op-head">
                <span className="op-type">{e.eventType}</span>
                <time dateTime={e.createdAt}>{clock(e.createdAt)}</time>
              </div>
              <p className="op-summary">{e.summary}</p>
              <p className="op-desc">{DESCRIPTION[e.eventType] ?? ''}</p>
              <details className="op-detail">
                <summary>Recorded detail</summary>
                <pre>{JSON.stringify(JSON.parse(e.detailJson), null, 2)}</pre>
              </details>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
