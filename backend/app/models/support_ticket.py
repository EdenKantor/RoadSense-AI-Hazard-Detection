"""
SupportTicket MongoDB document shape.

A support ticket created by any user (Citizen / Authority / Admin) directed at
either an Official team leader (for report-related issues) or to Admin Support
(for platform/technical issues).

MongoDB collection: support_tickets
"""
from enum import Enum


class TargetTeamType(str, Enum):
    """Which team a support ticket is routed to.

    Official tickets go to an Authority team leader and are usually tied to a
    specific report; Admin tickets go to platform/technical support.
    """

    Official = "Official"
    Admin = "Admin"


class TicketStatus(str, Enum):
    """Lifecycle state of a support ticket.

    Open is the initial state; InReview / WaitingForResponse are intermediate
    steps; Resolved / Closed are terminal.
    """

    Open = "Open"
    InReview = "InReview"
    WaitingForResponse = "WaitingForResponse"
    Resolved = "Resolved"
    Closed = "Closed"


SUPPORT_TICKET_DOCUMENT = {
    "_id": str,                          # UUID
    "created_by_user_id": str,           # author of the ticket
    "created_by_user_role": str,         # Citizen / Authority / Admin
    "target_team_type": str,             # Official | Admin
    "subject": str,                      # one of the predefined subjects
    "message": str,                      # free text
    "related_report_id": str,            # upload_id of related report (nullable)
    "related_zone": str,                 # zone name derived from related report (nullable)
    "status": str,                       # Open | InReview | WaitingForResponse | Resolved | Closed
    "assigned_official_user_id": str,    # Team leader's user_id when targeted to Official (nullable)
    "assigned_admin_user_id": str,       # Admin user_id when targeted to Admin (nullable)
    "responses": list,                   # [{author_id, author_role, text, created_at}]
    "status_history": list,              # [{from, to, changed_by, changed_at, note}]
    "created_at": str,                   # ISO-8601 UTC
    "updated_at": str,                   # ISO-8601 UTC
    "last_response_at": str,             # ISO-8601 UTC (nullable)
}


def new_support_ticket_doc(
    ticket_id: str,
    created_by_user_id: str,
    created_by_user_role: str,
    target_team_type: str,
    subject: str,
    message: str,
    related_report_id: str = None,
    related_zone: str = None,
    assigned_official_user_id: str = None,
    assigned_admin_user_id: str = None,
) -> dict:
    """Return a ready-to-insert support ticket document dict.

    Seeds an initial "Ticket created" entry into status_history and leaves the
    responses list empty. ``last_response_at`` is null until a reply is added.

    Args:
        ticket_id: UUID string used as the document _id.
        created_by_user_id: user._id of the ticket author.
        created_by_user_role: Citizen / Authority / Admin at time of creation.
        target_team_type: Official or Admin (see TargetTeamType).
        subject: One of the predefined subject options.
        message: Free-text body of the initial message.
        related_report_id: Optional uploads._id of a related report.
        related_zone: Optional zone name derived from the related report.
        assigned_official_user_id: Team leader's user_id for Official tickets.
        assigned_admin_user_id: Admin user_id for Admin-targeted tickets.

    Returns:
        A dict shaped according to ``SUPPORT_TICKET_DOCUMENT`` ready for insert_one.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    return {
        "_id": ticket_id,
        "created_by_user_id": created_by_user_id,
        "created_by_user_role": created_by_user_role,
        "target_team_type": target_team_type,
        "subject": subject,
        "message": message,
        "related_report_id": related_report_id,
        "related_zone": related_zone,
        "status": TicketStatus.Open.value,
        "assigned_official_user_id": assigned_official_user_id,
        "assigned_admin_user_id": assigned_admin_user_id,
        "responses": [],
        "status_history": [
            {
                "from": None,
                "to": TicketStatus.Open.value,
                "changed_by": created_by_user_id,
                "changed_at": now,
                "note": "Ticket created",
            }
        ],
        "created_at": now,
        "updated_at": now,
        "last_response_at": None,
    }
