This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

          curl -k -u mnoor:dBK1kGRs/MsbpOgGt1AF/lTxslLvazes -H "Content-Type: application/json" -X GET "https://10.90.0.105:9200/wazuh-alerts-4.*/_search" -d '{"size": 10,"sort": [{"@timestamp": "desc"}],"query": {"range": {"@timestamp": {"gte": "now-24h"}}}, "agent" : ["pgesvr1","SVR-portal-mypge-GCP","PGEKP-SVRX-LSD-7","PGEKP-SVRX-LABKmj-181","SVR-HSEPASS-DO","SVR-PAS-NotifMevent-DO","SVR-SVCMEVENT-DO","SVR-PEKKAMYPGE-DO","PGELHD-SVRX-ANT1-16","PGELHD-SVRX-Win-19","PGEKP-SVR-125"]}'

"terms": {
"agent.name.keyword": [
"pgesvr1",
"SVR-portal-mypge-GCP",
"PGEKP-SVRX-LSD-7",
"PGEKP-SVRX-LABKmj-181",
"SVR-HSEPASS-DO",
"SVR-PAS-NotifMevent-DO",
"SVR-SVCMEVENT-DO",
"SVR-PEKKAMYPGE-DO",
"PGELHD-SVRX-ANT1-16",
"PGELHD-SVRX-Win-19",
"PGEKP-SVR-125"
]
}
