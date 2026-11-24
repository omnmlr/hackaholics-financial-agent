# Railway legacy-service repurposing snapshot

Stored before replacing source/configuration. Existing **volume data is NOT copied**; preserve by detaching volumes (never deleting). Secret names, not values, are recorded. The project owner must maintain encrypted secret backups separately if needed for restoration.

```json
{
  "snapshotAt": "2026-11-24",
  "purpose": "Before repurposing failed AGUS services for Crypto Devnet API and worker",
  "projectId": "c8604a04-2913-4edf-b52a-cd333121ad1d",
  "environmentId": "02d06217-6ac8-4de9-9f93-6bc5f48734b7",
  "services": [
    {
      "service": {
        "id": "011ff58d-77ec-40f9-ae9f-67eca3e6972e",
        "name": "agus-counterpart-acceptance",
        "state": "live"
      },
      "latestDeployment": {
        "id": "78fd00ab-446f-4e30-aabb-162528380050",
        "status": "FAILED",
        "createdAt": "2026-11-14T04:31:03.447Z",
        "url": null
      },
      "domains": {
        "serviceDomains": [
          {
            "id": "98176920-d0cb-4c54-bf8a-d3275c845237",
            "domain": "agusweb.up.railway.app",
            "targetPort": 3000
          }
        ],
        "customDomains": []
      },
      "config": {
        "source": {
          "repo": "omnmlr/hackaholics-financial-agent",
          "branch": "implementation/agus-counterpart-20261114",
          "commitSha": "9027b860758089829910b2f1066ce5da85cf5d2d"
        },
        "networking": {
          "serviceDomains": {
            "agusweb.up.railway.app": {
              "port": 3000
            }
          }
        },
        "build": {
          "builder": "RAILPACK",
          "buildCommand": "npm run build",
          "buildEnvironment": "V3"
        },
        "deploy": {
          "startCommand": "env ZCASH_RECEIVE_WATCHER_ENABLED=true npm start -- --port 3000",
          "healthcheckPath": "/",
          "healthcheckTimeout": 180,
          "sleepApplication": true,
          "useLegacyStacker": false,
          "ipv6EgressEnabled": false,
          "runtime": "V2",
          "multiRegionConfig": {
            "iad": {
              "numReplicas": 1
            }
          }
        },
        "volumeMounts": {
          "922dc5df-c4d6-48a4-a08d-fe342085b006": {
            "mountPath": "/data"
          }
        }
      },
      "variableNames": [
        "AGUS_AGENT_ARCHITECTURE",
        "AGUS_WORKSPACE_ENABLED",
        "AI_API_KEY",
        "AI_MODEL",
        "AI_PROVIDER",
        "APP_ORIGIN",
        "COUNTERPART_PREVIEW_LOGIN_PASSWORD",
        "DATABASE_URL",
        "FINANCIAL_DEMO_ENABLED",
        "LIVE_OWNER_AUTHORIZED",
        "LIVE_RECONCILIATION_VALIDATED",
        "LIVE_TRANSFERS_ENABLED",
        "LIVE_WEBHOOK_VALIDATED",
        "NEXT_PUBLIC_POLLAR_API_KEY",
        "NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY",
        "NEXT_TELEMETRY_DISABLED",
        "NODE_ENV",
        "OPERATOR_ID",
        "OPERATOR_PASSWORD_HASH",
        "PAYMENT_MODE",
        "PAYSTACK_SECRET_KEY",
        "PAYSTACK_TRANSFERS_ENABLED",
        "POLLAR_TESTNET_USDC_ISSUER",
        "PORT",
        "RAILPACK_NODE_VERSION",
        "ZCASH_RECEIVE_SERVICE_URL",
        "ZCASH_RECEIVE_TOKEN",
        "ZCASH_WALLET_RPC_URL"
      ],
      "secretValues": "NOT SAVED; existing Railway values remain in the environment until explicitly removed"
    },
    {
      "service": {
        "id": "a2dbc68d-7cdc-40c4-9452-0706f6ee8a01",
        "name": "agus-zcash-receiving",
        "state": "live"
      },
      "latestDeployment": {
        "id": "84244d26-d688-48b9-be0c-551a348ca1a3",
        "status": "FAILED",
        "createdAt": "2026-11-20T12:39:57.362Z",
        "url": null
      },
      "domains": {
        "serviceDomains": [
          {
            "id": "b2a51d26-0cbd-4ff7-ae41-481f1d44324b",
            "domain": "agus-zcash-receiving-production.up.railway.app",
            "targetPort": 8080
          }
        ],
        "customDomains": []
      },
      "config": {
        "source": {
          "repo": "omnmlr/hackaholics-financial-agent",
          "branch": "implementation/agus-counterpart-20261114",
          "commitSha": "9027b860758089829910b2f1066ce5da85cf5d2d"
        },
        "networking": {
          "serviceDomains": {
            "agus-zcash-receiving-production.up.railway.app": {
              "port": 8080
            }
          }
        },
        "build": {
          "builder": "DOCKERFILE",
          "buildEnvironment": "V3",
          "dockerfilePath": "services/zcash-receiving/Dockerfile"
        },
        "deploy": {
          "healthcheckPath": "/healthz",
          "limitOverride": {
            "containers": {
              "cpu": 1,
              "memoryBytes": 1000000000
            }
          },
          "healthcheckTimeout": 180,
          "sleepApplication": true,
          "useLegacyStacker": false,
          "ipv6EgressEnabled": false,
          "runtime": "V2",
          "multiRegionConfig": {
            "iad": {
              "numReplicas": 1
            }
          }
        },
        "volumeMounts": {
          "51b12ab8-36f4-49fa-ab00-bb35bda2cb2b": {
            "mountPath": "/data"
          }
        }
      },
      "variableNames": [
        "PORT",
        "RUST_LOG",
        "ZAW_PASSWORD",
        "ZCASH_RECEIVE_TOKEN"
      ],
      "secretValues": "NOT SAVED; existing Railway values remain in the environment until explicitly removed"
    }
  ],
  "preservedVolumes": [
    "922dc5df-c4d6-48a4-a08d-fe342085b006",
    "51b12ab8-36f4-49fa-ab00-bb35bda2cb2b"
  ],
  "note": "Config backup only. Do not delete volumes or claim this is a contents backup. Repurpose must detach volumes without deleting them; previous data remain on Railway volumes. Configuration includes no secret values."
}
```
