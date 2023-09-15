const wrap = (fn) => (...args) => fn(...args).catch(args[2]);

module.exports = {
    /**
     * 傳入 async function，回傳會將拋出的例外往 next 丟的 middleware function。
     */
    wrap,

    /**
     * 傳入一 ZodSchema 物件，產生驗證請求用的 middleware function。
     * 
     * 你的 ZodSchema 可能會長得像：
     * ```
     * z.object({
     *     query: z.object({ ... }),
     *     params: z.object({ ... }),
     *     body: z.object({
     *         name: z.string().trim().minLength(1),
     *         age: z.number().nonnegative(),
     *     }),
     * });
     * ```
     * 
     * 在 query (網址問號後面那串)、params (router path 中以冒號開頭的參數)
     * 、body 中挑你想驗證的就好了，不需要全部都寫
     */
    validate: (zodSchema) => wrap(async (req, res, next) => {
        let { success, data, error } = await zodSchema.safeParseAsync({
            body: req.body,
            query: req.query,
            params: req.params,
        });
        if (success) {
            let {body, query, params} = data;
            if (body) req.body = body;
            if (query) req.query = query;
            if (params) req.params = params;
            next();
        } else {
            res.status(400).send({ error: 'invalid_request', details: error });
        }
    })
};
