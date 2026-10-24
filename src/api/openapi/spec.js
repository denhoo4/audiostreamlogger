/**
 * OpenAPI 3 document builder for the api service.
 *
 * Pure module: NO DB handle, NO session, NO server side effects. It only
 * describes the hand-written Express routes (routes/*.js) as an OpenAPI 3.0
 * document generated from zod schemas via @asteasolutions/zod-to-openapi, so a
 * `node --test` test can `require` it directly and assert the document's shape
 * without booting the app (index.js is not requireable — it opens the DB and
 * exit(1)s on failure).
 *
 * The real endpoints (methods, paths, auth, request bodies, response shapes)
 * were read from the route files; this file does not invent endpoints. Where a
 * response is a deeply nested browse/analysis tree or a binary stream, a
 * permissive schema with a description is used on purpose (correctness over
 * exhaustive field detail).
 */
const { z } = require('zod');
const {
    OpenAPIRegistry,
    OpenApiGeneratorV3,
    extendZodWithOpenApi,
} = require('@asteasolutions/zod-to-openapi');

extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Shared error schemas (the api uses the same shapes everywhere).
// ---------------------------------------------------------------------------
const ErrorResponse = z
    .object({
        error: z.string(),
        field: z.string().optional(),
    })
    .openapi('ErrorResponse');

const AuthRequiredResponse = z
    .object({ error: z.literal('authentication required') })
    .openapi('AuthRequiredResponse');

// ---------------------------------------------------------------------------
// Domain schemas (grounded in the route/service code).
// ---------------------------------------------------------------------------
const StreamInput = z
    .object({
        country: z.string().openapi({ example: 'NL' }),
        name: z.string().openapi({ example: 'Test Stream' }),
        folder: z.string().openapi({ example: 'test_stream' }),
        url: z.string().url().openapi({ example: 'https://example.com/stream' }),
        codec: z
            .enum(['mp3', 'opus', 'flac'])
            .optional()
            .openapi({
                example: 'mp3',
                description:
                    'Recording codec. Defaults to mp3 when omitted. Lossy ' +
                    'codecs (mp3/opus) take bitrate_kbps; the lossless codec ' +
                    '(flac) takes bit_depth.',
            }),
        bitrate_kbps: z
            .number()
            .int()
            .nullable()
            .optional()
            .openapi({
                example: 160,
                description:
                    'Target bitrate (kbps) for a lossy codec; null/omitted ' +
                    'for flac. Must be from the codec bitrate set.',
            }),
        bit_depth: z
            .number()
            .int()
            .nullable()
            .optional()
            .openapi({
                example: 16,
                description:
                    'PCM sample bit depth (16 or 24) for flac; null/omitted ' +
                    'for lossy codecs.',
            }),
    })
    .openapi('StreamInput');

const StreamTestUrlInput = z
    .object({
        url: z.string().openapi({ example: 'https://example.com/stream' }),
    })
    .openapi('StreamTestUrlInput');

const StreamTestResult = z
    .object({
        reachable: z.boolean(),
        status: z.number().int().optional(),
        contentType: z.string().optional(),
        detail: z.string().openapi({ example: 'reachable audio stream' }),
    })
    .openapi('StreamTestResult');

const Stream = StreamInput.extend({
    id: z.number().int(),
    sort_order: z.number().int().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
}).openapi('Stream');

const SettingsEntry = z
    .object({
        country: z.string(),
        name: z.string(),
        folder: z.string(),
        url: z.string(),
        codec: z.enum(['mp3', 'opus', 'flac']).openapi({
            example: 'mp3',
            description:
                'Recording codec; the player derives the file extension from ' +
                'it (codec === extension for mp3/opus/flac).',
        }),
    })
    .openapi('SettingsEntry');

const Job = z
    .object({
        id: z.number().int(),
        type: z.string(),
        status: z.string(),
        source: z.string().nullable().optional(),
        output: z.string().nullable().optional(),
        created_at: z.string().nullable().optional(),
        started_at: z.string().nullable().optional(),
        finished_at: z.string().nullable().optional(),
    })
    .openapi('Job');

const Schedule = z
    .object({
        type: z.string(),
        enabled: z.union([z.boolean(), z.number()]).optional(),
        frequency: z.string().nullable().optional(),
        minute: z.number().int().nullable().optional(),
        hour: z.number().int().nullable().optional(),
        day_of_week: z.number().int().nullable().optional(),
    })
    .openapi('Schedule');

const ScheduleUpdate = z
    .object({
        enabled: z.boolean().optional(),
        frequency: z.string().optional(),
        minute: z.number().int().optional(),
        hour: z.number().int().optional(),
        day_of_week: z.number().int().optional(),
    })
    .openapi('ScheduleUpdate');

const WorkerStatus = z
    .object({
        last_heartbeat: z.string().nullable(),
        status: z.string().nullable(),
        current_job: Job.nullable(),
    })
    .openapi('WorkerStatus');

const AnalysisSummary = z
    .object({
        per_stream: z.array(z.record(z.string(), z.any())),
        overall: z.record(z.string(), z.any()),
    })
    .openapi('AnalysisSummary');

const AnalysisGaps = z
    .object({
        folder: z.string(),
        start: z.string(),
        end: z.string(),
        expected_count: z.number().int(),
        present_count: z.number().int(),
        missing: z.array(z.object({ date: z.string(), hour: z.number().int() })),
        coverage_ratio: z.number(),
    })
    .openapi('AnalysisGaps');

const StreamHealth = z
    .object({
        folder: z.string(),
        name: z.string(),
        recordingNow: z.boolean(),
        last24h: z.object({
            complete: z.boolean(),
            gapCount: z.number().int(),
            gaps: z.array(
                z.object({ date: z.string(), hour: z.string() })
            ),
        }),
        lastSlotStatus: z.string().nullable(),
    })
    .openapi('StreamHealth');

const StreamHealthResponse = z
    .object({
        window_hours: z.number().int(),
        generated_slot: z.object({ date: z.string(), hour: z.string() }),
        counts: z.object({
            total: z.number().int(),
            recordingNow: z.number().int(),
            notRecording: z.number().int(),
        }),
        streams: z.array(StreamHealth),
    })
    .openapi('StreamHealthResponse');

const StorageEstimate = z
    .object({
        retention_hours: z.number(),
        actual_bytes: z.number(),
        projection: z.object({
            retentionHours: z.number(),
            totalProjectedBytes: z.number(),
            perStream: z.array(
                z.object({
                    folder: z.string(),
                    name: z.string(),
                    bytesPerHour: z.number(),
                    source: z.enum(['measured', 'estimated']),
                    projectedBytes: z.number(),
                })
            ),
        }),
    })
    .openapi('StorageEstimate');

const BackupImport = z
    .object({
        streams: z.array(StreamInput).optional(),
        app_config: z.record(z.string(), z.any()).optional(),
    })
    .openapi('BackupImport');

const BackupImportResult = z
    .object({
        imported: z.number().int(),
        updated: z.number().int(),
        skipped: z.array(z.record(z.string(), z.any())),
        config_applied: z.array(z.string()),
        config_skipped: z.array(z.record(z.string(), z.any())),
    })
    .openapi('BackupImportResult');

/**
 * Build the OpenAPI 3.0 document. Pure — safe to call from a test or a route.
 * @returns {object} the generated OpenAPI 3.0 document.
 */
function buildOpenApiDocument() {
    const registry = new OpenAPIRegistry();

    // Session-cookie security scheme (express-session's connect.sid). Authed
    // routes reference it; public routes leave security empty.
    const sessionCookie = registry.registerComponent(
        'securitySchemes',
        'sessionCookie',
        {
            type: 'apiKey',
            in: 'cookie',
            name: 'connect.sid',
            description:
                'Session cookie issued by POST /auth/login. Admin-only API.',
        }
    );

    const authed = [{ [sessionCookie.name]: [] }];

    const json = (schema) => ({ 'application/json': { schema } });
    const authErr = {
        401: {
            description: 'authentication required',
            content: json(AuthRequiredResponse),
        },
    };
    const validationErr = {
        400: { description: 'validation error', content: json(ErrorResponse) },
    };
    const serverErr = {
        500: { description: 'internal server error', content: json(ErrorResponse) },
    };

    // ---- system ---------------------------------------------------------
    registry.registerPath({
        method: 'get',
        path: '/healthz',
        tags: ['system'],
        summary: 'Liveness probe',
        responses: {
            200: {
                description: 'service alive',
                content: json(z.object({ status: z.literal('ok') })),
            },
        },
    });

    // ---- auth -----------------------------------------------------------
    registry.registerPath({
        method: 'post',
        path: '/auth/login',
        tags: ['auth'],
        summary: 'Log in and open a session (public)',
        request: {
            body: {
                content: json(
                    z.object({ username: z.string(), password: z.string() })
                ),
            },
        },
        responses: {
            200: {
                description: 'authenticated',
                content: json(
                    z.object({ authenticated: z.literal(true), username: z.string() })
                ),
            },
            400: { description: 'missing fields', content: json(ErrorResponse) },
            401: { description: 'invalid credentials', content: json(ErrorResponse) },
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'post',
        path: '/auth/logout',
        tags: ['auth'],
        summary: 'Destroy the session (public, idempotent)',
        responses: {
            200: {
                description: 'logged out',
                content: json(z.object({ ok: z.literal(true) })),
            },
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/auth/me',
        tags: ['auth'],
        summary: 'Current auth state (public)',
        responses: {
            200: {
                description: 'auth state',
                content: json(
                    z.object({
                        authenticated: z.boolean(),
                        username: z.string().optional(),
                    })
                ),
            },
        },
    });
    registry.registerPath({
        method: 'post',
        path: '/auth/change-password',
        tags: ['auth'],
        summary: 'Change the current user password',
        security: authed,
        request: {
            body: {
                content: json(
                    z.object({
                        currentPassword: z.string(),
                        newPassword: z.string(),
                    })
                ),
            },
        },
        responses: {
            200: {
                description: 'password changed',
                content: json(z.object({ ok: z.literal(true) })),
            },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });

    // ---- settings / app-config / streams (routes/api.js) ----------------
    registry.registerPath({
        method: 'get',
        path: '/api/settings',
        tags: ['streams'],
        summary: 'Public stream list for the player selector',
        responses: {
            200: {
                description: 'stream projections',
                content: json(z.array(SettingsEntry)),
            },
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/settings2',
        tags: ['streams'],
        summary: 'Public nested browse tree (country → stream → folders)',
        responses: {
            200: {
                description: 'nested browse tree (permissive shape)',
                content: json(z.record(z.string(), z.any())),
            },
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/app-config/public',
        tags: ['streams'],
        summary: 'Public branding (page title)',
        responses: {
            200: {
                description: 'public config',
                content: json(
                    z.object({
                        title: z.string(),
                        default_stream_folder: z.string(),
                    })
                ),
            },
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'put',
        path: '/api/app-config/default-stream',
        tags: ['streams'],
        summary: 'Set or clear the player default stream folder',
        security: authed,
        request: { body: { content: json(z.object({ folder: z.string() })) } },
        responses: {
            200: {
                description: 'updated default stream folder',
                content: json(z.object({ default_stream_folder: z.string() })),
            },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'put',
        path: '/api/app-config/title',
        tags: ['streams'],
        summary: 'Update the editable page title',
        security: authed,
        request: { body: { content: json(z.object({ title: z.string() })) } },
        responses: {
            200: {
                description: 'updated title',
                content: json(z.object({ title: z.string() })),
            },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/worker/status',
        tags: ['streams'],
        summary: 'Worker liveness + current job',
        security: authed,
        responses: {
            200: { description: 'worker status', content: json(WorkerStatus) },
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/streams',
        tags: ['streams'],
        summary: 'List streams (admin, with id + timestamps)',
        security: authed,
        responses: {
            200: { description: 'stream rows', content: json(z.array(Stream)) },
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'post',
        path: '/api/streams',
        tags: ['streams'],
        summary: 'Create a stream',
        security: authed,
        request: { body: { content: json(StreamInput) } },
        responses: {
            201: { description: 'created', content: json(Stream) },
            ...validationErr,
            ...authErr,
            409: {
                description: 'folder already in use',
                content: json(ErrorResponse),
            },
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'post',
        path: '/api/streams/test-url',
        tags: ['streams'],
        summary:
            'Advisory reachability probe for a stream URL (non-blocking "Test")',
        description:
            'Admin-only helper that checks whether a URL answers like a ' +
            'reachable audio stream. It does NOT persist anything and is NOT a ' +
            'gate on create/update. Validates http(s) URL first (400 on ' +
            'malformed/non-http(s) input), then probes with a bounded timeout; ' +
            'network/timeout/non-2xx/non-audio outcomes return 200 with ' +
            'reachable:false and a short detail.',
        security: authed,
        request: { body: { content: json(StreamTestUrlInput) } },
        responses: {
            200: {
                description: 'probe result (reachable true/false + detail)',
                content: json(StreamTestResult),
            },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'put',
        path: '/api/streams/reorder',
        tags: ['streams'],
        summary: 'Persist a new stream order (sort_order by array index)',
        security: authed,
        request: {
            body: {
                content: json(z.object({ order: z.array(z.number().int()) })),
            },
        },
        responses: {
            200: {
                description: 'reordered',
                content: json(z.object({ ok: z.literal(true) })),
            },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'put',
        path: '/api/streams/{id}',
        tags: ['streams'],
        summary: 'Update a stream',
        security: authed,
        request: {
            params: z.object({ id: z.coerce.number().int().openapi({ example: 1 }) }),
            body: { content: json(StreamInput) },
        },
        responses: {
            200: { description: 'updated', content: json(Stream) },
            ...validationErr,
            ...authErr,
            404: { description: 'stream not found', content: json(ErrorResponse) },
            409: {
                description: 'folder already in use',
                content: json(ErrorResponse),
            },
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'delete',
        path: '/api/streams/{id}',
        tags: ['streams'],
        summary: 'Delete a stream',
        security: authed,
        request: {
            params: z.object({ id: z.coerce.number().int().openapi({ example: 1 }) }),
        },
        responses: {
            200: {
                description: 'deleted',
                content: json(z.object({ ok: z.literal(true) })),
            },
            ...validationErr,
            ...authErr,
            404: { description: 'stream not found', content: json(ErrorResponse) },
            ...serverErr,
        },
    });

    // ---- jobs (routes/jobs.js, all authed) ------------------------------
    registry.registerPath({
        method: 'get',
        path: '/api/jobs',
        tags: ['jobs'],
        summary: 'List recent jobs',
        security: authed,
        request: {
            query: z.object({
                limit: z.coerce
                    .number()
                    .int()
                    .min(1)
                    .max(200)
                    .optional()
                    .openapi({ description: 'default 50', example: 50 }),
            }),
        },
        responses: {
            200: { description: 'recent jobs', content: json(z.array(Job)) },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'post',
        path: '/api/jobs',
        tags: ['jobs'],
        summary: 'Enqueue a manual job',
        security: authed,
        request: {
            body: {
                content: json(
                    z.object({
                        type: z.enum(['cleaner', 'peakfilegenerator', 'reconcile']),
                    })
                ),
            },
        },
        responses: {
            201: { description: 'enqueued', content: json(Job) },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/jobs/schedules',
        tags: ['jobs'],
        summary: 'List schedules',
        security: authed,
        responses: {
            200: { description: 'schedules', content: json(z.array(Schedule)) },
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'put',
        path: '/api/jobs/schedules/{type}',
        tags: ['jobs'],
        summary: 'Update a schedule',
        security: authed,
        request: {
            params: z.object({
                type: z.enum(['cleaner', 'peakfilegenerator', 'reconcile']),
            }),
            body: { content: json(ScheduleUpdate) },
        },
        responses: {
            200: { description: 'updated schedule', content: json(Schedule) },
            ...validationErr,
            ...authErr,
            404: { description: 'schedule not found', content: json(ErrorResponse) },
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/jobs/config/log_retention',
        tags: ['jobs'],
        summary: 'Current log-retention hours',
        security: authed,
        responses: {
            200: {
                description: 'retention',
                content: json(z.object({ hours: z.number().nullable() })),
            },
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'put',
        path: '/api/jobs/config/log_retention',
        tags: ['jobs'],
        summary: 'Set log-retention hours (1..8760)',
        security: authed,
        request: {
            body: {
                content: json(
                    z.object({ hours: z.number().int().min(1).max(8760) })
                ),
            },
        },
        responses: {
            200: {
                description: 'updated',
                content: json(z.object({ hours: z.number() })),
            },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/jobs/stream',
        tags: ['jobs'],
        summary: 'Live job feed (Server-Sent Events)',
        description:
            'Server-Sent Events stream (text/event-stream). Emits `snapshot` on ' +
            'connect, `job` on any row change, and `ping` keep-alives. Not a ' +
            'JSON response body.',
        security: authed,
        responses: {
            200: {
                description: 'event stream',
                content: { 'text/event-stream': {} },
            },
            ...authErr,
        },
    });

    // ---- analysis (routes/analysis.js, all authed) ----------------------
    registry.registerPath({
        method: 'get',
        path: '/api/analysis/summary',
        tags: ['analysis'],
        summary: 'Per-stream + overall recording roll-up',
        security: authed,
        responses: {
            200: { description: 'summary', content: json(AnalysisSummary) },
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/analysis/gaps',
        tags: ['analysis'],
        summary: 'Hourly coverage gaps for one folder over a date range',
        security: authed,
        request: {
            query: z.object({
                folder: z.string().openapi({ example: 'test_stream' }),
                start: z.string().openapi({ example: '2026-01-01' }),
                end: z.string().openapi({ example: '2026-01-02' }),
            }),
        },
        responses: {
            200: { description: 'gap analysis', content: json(AnalysisGaps) },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/analysis/stream-health',
        tags: ['analysis'],
        summary:
            'Per-stream two-signal health: recording-now check + last-24h gap summary',
        security: authed,
        request: {
            query: z.object({
                windowHours: z.coerce
                    .number()
                    .int()
                    .min(1)
                    .max(168)
                    .optional()
                    .openapi({ description: 'default 24', example: 24 }),
            }),
        },
        responses: {
            200: {
                description: 'stream health',
                content: json(StreamHealthResponse),
            },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/analysis/storage-estimate',
        tags: ['analysis'],
        summary:
            'Projected steady-state disk usage per stream + total, plus actual on-disk bytes',
        security: authed,
        responses: {
            200: {
                description: 'storage estimate',
                content: json(StorageEstimate),
            },
            ...authErr,
            ...serverErr,
        },
    });

    // ---- branding (routes/branding.js) ----------------------------------
    registry.registerPath({
        method: 'post',
        path: '/api/branding/favicon',
        tags: ['branding'],
        summary: 'Upload a favicon (raw binary, ≤1 MiB)',
        security: authed,
        request: {
            body: {
                content: {
                    'image/png': { schema: { type: 'string', format: 'binary' } },
                    'image/x-icon': { schema: { type: 'string', format: 'binary' } },
                    'image/vnd.microsoft.icon': {
                        schema: { type: 'string', format: 'binary' },
                    },
                    'image/svg+xml': {
                        schema: { type: 'string', format: 'binary' },
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'stored',
                content: json(
                    z.object({ ok: z.literal(true), mime: z.string() })
                ),
            },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/branding/favicon',
        tags: ['branding'],
        summary: 'Serve the stored favicon or a bundled default (public)',
        responses: {
            200: {
                description: 'favicon image',
                content: {
                    'image/png': { schema: { type: 'string', format: 'binary' } },
                    'image/x-icon': { schema: { type: 'string', format: 'binary' } },
                    'image/svg+xml': {
                        schema: { type: 'string', format: 'binary' },
                    },
                },
            },
        },
    });

    // ---- backup (routes/backup.js, all authed) --------------------------
    registry.registerPath({
        method: 'get',
        path: '/api/backup/export',
        tags: ['backup'],
        summary: 'Download a JSON backup of streams + safe config',
        security: authed,
        responses: {
            200: {
                description: 'JSON attachment',
                content: json(z.record(z.string(), z.any())),
            },
            ...authErr,
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'get',
        path: '/api/backup/db',
        tags: ['backup'],
        summary: 'Download the raw SQLite database file',
        security: authed,
        responses: {
            200: {
                description: 'octet-stream attachment (app.db)',
                content: {
                    'application/octet-stream': {
                        schema: { type: 'string', format: 'binary' },
                    },
                },
            },
            ...authErr,
            404: {
                description: 'database file not found',
                content: json(ErrorResponse),
            },
            ...serverErr,
        },
    });
    registry.registerPath({
        method: 'post',
        path: '/api/backup/import',
        tags: ['backup'],
        summary: 'Import streams + apply safe config (≤5 MB body)',
        security: authed,
        request: { body: { content: json(BackupImport) } },
        responses: {
            200: { description: 'import result', content: json(BackupImportResult) },
            ...validationErr,
            ...authErr,
            ...serverErr,
        },
    });

    // ---- util (routes/util.js) ------------------------------------------
    registry.registerPath({
        method: 'post',
        path: '/util/selection-export',
        tags: ['util'],
        summary: 'Export a trimmed slice of a recording (public)',
        description:
            'Re-encodes a trimmed clip of a recording in the source ' +
            "container. The optional `ext` selects the codec/container " +
            '(mp3/opus/flac); it defaults to mp3 for backward-compatible ' +
            'callers. The response container follows `ext` (mp3→audio/mpeg, ' +
            'opus→audio/ogg, flac→audio/flac).',
        request: {
            body: {
                content: json(
                    z.object({
                        station_id: z.string(),
                        year: z.string(),
                        month: z.string(),
                        day: z.string(),
                        hour: z.string(),
                        startTime: z.union([z.string(), z.number()]),
                        endTime: z.union([z.string(), z.number()]),
                        ext: z
                            .enum(['mp3', 'opus', 'flac'])
                            .optional()
                            .openapi({
                                example: 'mp3',
                                description:
                                    'Source/output container; defaults to mp3.',
                            }),
                    })
                ),
            },
        },
        responses: {
            200: {
                description:
                    'Exported audio file stream (mp3/opus/flac per ext)',
                content: {
                    'audio/mpeg': {
                        schema: { type: 'string', format: 'binary' },
                    },
                },
            },
            400: { description: 'invalid parameters (text body)' },
            404: { description: 'file not found (text body)' },
            500: { description: 'processing error (text body)' },
        },
    });

    const generator = new OpenApiGeneratorV3(registry.definitions);
    return generator.generateDocument({
        openapi: '3.0.0',
        info: {
            title: 'audiostreamlogger API',
            version: '0.1.0',
            description:
                'Internal, admin-only API: auth, settings/streams CRUD, jobs, ' +
                'analysis, backup, branding, and selection export. Served ' +
                'same-origin behind nginx under /api, /auth, and /util.',
        },
    });
}

module.exports = { buildOpenApiDocument };
