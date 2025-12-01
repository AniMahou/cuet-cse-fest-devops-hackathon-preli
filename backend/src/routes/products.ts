import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Static, Type } from '@sinclair/typebox';
import { ProductModel } from '../models/product';

// Request/Response schemas for validation
const CreateProductSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  price: Type.Number({ minimum: 0 }),
});

const ProductResponseSchema = Type.Object({
  _id: Type.String(),
  name: Type.String(),
  price: Type.Number(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

const PaginationQuerySchema = Type.Object({
  limit: Type.Optional(Type.String()),
  offset: Type.Optional(Type.String()),
});

type CreateProductRequest = Static<typeof CreateProductSchema>;
type ProductResponse = Static<typeof ProductResponseSchema>;
type PaginationQuery = Static<typeof PaginationQuerySchema>;

export async function productsRoutes(app: FastifyInstance) {
  // Create a product
  app.post<{ Body: CreateProductRequest; Reply: ProductResponse }>(
    '/',
    {
      schema: {
        body: CreateProductSchema,
        response: { 201: ProductResponseSchema },
      },
    },
    async (request: FastifyRequest<{ Body: CreateProductRequest }>, reply: FastifyReply) => {
      try {
        const { name, price } = request.body;

        if (!name || typeof name !== 'string' || name.trim() === '') {
          return reply.status(400).send({ error: 'Invalid name' });
        }

        if (typeof price !== 'number' || Number.isNaN(price) || price < 0) {
          return reply.status(400).send({ error: 'Invalid price' });
        }

        const product = new ProductModel({ name: name.trim(), price });
        const saved = await product.save();

        request.log.info('Product created:', saved._id);
        return reply.status(201).send(saved);
      } catch (err) {
        request.log.error('POST /api/products error:' + err);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // List products with pagination
  app.get<{ Querystring: PaginationQuery; Reply: ProductResponse[] }>(
    '/',
    {
      schema: {
        querystring: PaginationQuerySchema,
        response: { 200: Type.Array(ProductResponseSchema) },
      },
    },
    async (request: FastifyRequest<{ Querystring: PaginationQuery }>, reply: FastifyReply) => {
      try {
        const limit = Math.min(parseInt(request.query.limit as string) || 10, 100);
        const offset = parseInt(request.query.offset as string) || 0;

        const list = await ProductModel.find()
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .lean();

        return reply.send(list);
      } catch (err) {
        request.log.error('GET /api/products error:' + err);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );

  // Get product by ID
  app.get<{ Params: { id: string }; Reply: ProductResponse }>(
    '/:id',
    { schema: { response: { 200: ProductResponseSchema } } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const product = await ProductModel.findById(request.params.id).lean();

        if (!product) {
          return reply.status(404).send({ error: 'Product not found' });
        }

        return reply.send(product);
      } catch (err) {
        request.log.error('GET /api/products/:id error:' + err);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    }
  );
}