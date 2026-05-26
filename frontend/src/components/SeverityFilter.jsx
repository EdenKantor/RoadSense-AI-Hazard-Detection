/**
 * SeverityFilter — dropdown to filter map events by severity.
 * Props:
 *   value    : current severity filter ("" | "Low" | "Medium" | "High")
 *   onChange : (value: string) => void
 */
export default function SeverityFilter({ value, onChange }) {
    return (
        <div style={{ display: "inline-block" }}>
            <label htmlFor="severity-filter">Severity</label>
            <select
                id="severity-filter"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                style={{ width: "auto", marginBottom: 0 }}
            >
                <option value="">All</option>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
            </select>
        </div>
    );
}
