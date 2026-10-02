# letsgetdown tools

| Tool | Inputs | What it does |
| --- | --- | --- |
| `shows_tonight` | Optional: `neighborhood` (string) | Lists up to 20 upcoming shows on the current Los Angeles calendar date. |
| `search_shows` | Required: `start_date`, `end_date` (strings). Optional: `genre`, `neighborhood` (strings); `max_price` (number). | Finds up to 20 upcoming shows in the site's data within an inclusive date range. Shows with unknown prices remain included when `max_price` is set. |
| `get_show` | Required: `show_id` (UUID string) | Gets details for one show. |
| `set_my_email` | Required: `email` (string) | Registers one email address on this machine for the email tools. Does not send mail. |
| `send_show_to_me` | Required: `show_id` (string). Optional: `note` (string). | Emails one upcoming show with its full ticket-purchase URL. Requires `set_my_email` first. |
| `email_summary` | Required: `show_ids` (array of 1–20 strings). | Emails a summary of selected upcoming shows, each with a full ticket-purchase URL. Requires `set_my_email` first. |
