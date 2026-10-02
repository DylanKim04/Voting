# 🗳️ AASA Deliberations

Anonymous voting for AASA eboard deliberations. No more closing your eyes and counting hands:
send one link in the group chat, everyone joins with their name, and votes are counted anonymously.

## What it does

- **Join with a link.** People open the link, type their name, and they're in. No accounts or passwords.
- **Anonymous votes.** The server keeps *who has voted* (so nobody votes twice) separately from
  *the count*, so no one, not even admins, can see how a person voted.
- **Hidden until revealed.** While a vote is open, everyone only sees "5 of 12 have voted".
  The count shows up only when an admin presses **Reveal count**.
- **Positions with applicants.** For example, Co-Pub (Thomas Ok, Capri, Fayina), PR (Michelle, Gilbert, Mehreen),
  Photo (Jeysac Pech, Matthew, Jules, David). These are loaded the first time the app starts, and admins can add, rename or delete them.
- **Vote counts next to each name.** After a vote is revealed, each applicant shows their vote count from the latest round.
- **Notes on each person.** Tap 📝 under any name to read or add notes. You can delete your own notes, and admins can delete any note.
- **Vote to remove someone.** Admins can start a "Remove X?" vote (Yes / No / Abstain). If the majority votes yes,
  a **Remove** button appears. Removed people are crossed out and can be restored.
- **Votes for people who aren't there.** While a vote is open, admins can add a vote on behalf of
  someone who's absent: type their name and pick their choice. The name is listed so nobody gets
  counted twice, but the choice goes into the anonymous tally like everyone else's.
- **Lock in a winner.** Once the votes settle, an admin locks one person in for the role. 👑
- **Positions with more than one opening.** Admins use the **Spots − / +** control on a position to set
  how many people it takes. Voters can then pick up to that many people, and admins can lock in that many
  (a **Lock in A & B** button appears for the top vote-getters).
- **Live updates.** Everyone's screen updates on its own. No refreshing.

## Running a meeting

1. Open the site and tap **I'm running the meeting** (or **Admin** in the top bar). Enter the admin PIN.
2. Under **Admin tools**, copy the invite link and paste it in the GC.
3. On a position, tap **Start vote**. Everyone picks one option and submits.
4. Watch "X of Y have voted". When everyone's in, tap **Close & reveal count**.
5. Tied? Start another round. Clear winner? Tap **👑 Lock in**.

Only one vote can be open at a time. That keeps everyone focused on the same question.

## Run it on your computer

Requires [Node.js](https://nodejs.org) 18 or newer. There's nothing to install.

```bash
ADMIN_PIN=pick-a-secret npm start
# open http://localhost:3000
```

## Put it online (so you can share a link)

The easiest free option is [Render](https://render.com):

1. Create a **New → Web Service** and connect this GitHub repo.
2. **Build command:** leave empty (or `npm install`). **Start command:** `npm start`.
3. Under **Environment**, add `ADMIN_PIN` with a secret only eboard leads know.
4. Deploy, then share the `https://….onrender.com` link.

Railway, Fly.io and Glitch work the same way: run `npm start` and set `ADMIN_PIN`.

> **Heads up:** on free hosting the disk can reset when the app restarts or goes to sleep, which wipes
> the saved data (`data.json`). That's fine for a single meeting. If you want results to survive
> between meetings, add a persistent disk (Render → *Disks*) and set `DATA_FILE` to a path on it,
> such as `/var/data/data.json`.

## Settings

| Variable    | Default       | What it does                            |
|-------------|---------------|-----------------------------------------|
| `ADMIN_PIN` | `aasa`        | PIN to unlock admin tools. **Change this!** |
| `PORT`      | `3000`        | Port to listen on                        |
| `DATA_FILE` | `./data.json` | Where everything is saved               |

## How it's built

- `server.js`: a small Node server with no dependencies. It handles the JSON API, live updates
  (Server-Sent Events) and saving to a JSON file.
- `public/`: the page itself in plain HTML, CSS and JavaScript.
