/**
 * StatusFilter — dropdown to filter map events by lifecycle status.
 * Props:
 *   value    : current status filter string
 *   onChange : (value: string) => void
 */
export default function StatusFilter({ value, onChange }) {
    const statuses = ["Reported", "UnderReview", "Scheduled", "Resolved", "Rejected"];
    return (
        <div style={{ display: "inline-block", marginLeft: "1rem" }}>
            <label htmlFor="status-filter">Status</label>
            <select
                id="status-filter"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                style={{ width: "auto", marginBottom: 0 }}
            >
                <option value="">All</option>
                {statuses.map((s) => (
                    <option key={s} value={s}>{s}</option>
                ))}
            </select>
        </div>
    );
}
