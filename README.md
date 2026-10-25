# Echo by Amitesh

A chat web app with a **Claude / Gemini** switch. You can also attach a photo and ask about it.

```
index.html      the chat page (what people see)
api/chat.js     the server part (keeps your API keys secret)
api/_prompt.js  Echo's personality: edit this to change how Echo talks
```

## Put it on the internet (Vercel, free)

1. Make a free account at vercel.com.
2. Upload this folder to a new GitHub repository, then in Vercel press **Add New > Project** and pick that repository. (Or, on a laptop, run `npx vercel` inside this folder.)
3. Before you press Deploy, open **Environment Variables** and add:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | your Claude key |
| `GEMINI_API_KEY` | your Gemini key |
| `ACCESS_CODE` | any password you choose (recommended) |

4. Press **Deploy**. Vercel gives you a link like `echo-xxxx.vercel.app`.

`ACCESS_CODE` matters: without it, anyone who finds your link can chat and use up your Claude credit. With it, Echo asks for the code once on each device.

Never type your API keys into `index.html` or any file in this folder. They go only in Vercel's Environment Variables.

## Changing things

- **Echo's personality:** edit `api/_prompt.js`, then deploy again.
- **Model versions:** by default Echo uses `claude-sonnet-5-5` and `gemini-flash-latest`. To change them, add `CLAUDE_MODEL` or `GEMINI_MODEL` in Environment Variables.
- **Photos only for now:** PDFs and voice are not added yet.
