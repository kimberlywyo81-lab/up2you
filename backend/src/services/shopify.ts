import '@shopify/shopify-api/adapters/node';
import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import { configService } from './config.js';

interface ShopifyConfig {
  shopDomain: string;
  accessToken: string;
  apiKey?: string;
  apiSecret?: string;
}

export const shopifyService = {
  async getConfig(): Promise<ShopifyConfig | null> {
    // Try database first
    const dbConfig = await configService.getConfig('shopify');
    if (dbConfig && dbConfig.is_active) {
      return dbConfig.config as ShopifyConfig;
    }

    // Fallback to env vars
    if (process.env.SHOPIFY_SHOP_DOMAIN && process.env.SHOPIFY_ACCESS_TOKEN) {
      return {
        shopDomain: process.env.SHOPIFY_SHOP_DOMAIN,
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
        apiKey: process.env.SHOPIFY_API_KEY || '',
        apiSecret: process.env.SHOPIFY_API_SECRET || ''
      };
    }

    return null;
  },

  async isConfigured(): Promise<boolean> {
    const config = await this.getConfig();
    return !!config;
  },

  async getProducts() {
    const config = await this.getConfig();
    if (!config) {
      throw new Error('Shopify is not configured');
    }

    const shopify = shopifyApi({
      apiKey: config.apiKey || 'dummy_key',
      apiSecretKey: config.apiSecret || 'dummy_secret',
      scopes: ['read_products'],
      hostName: config.shopDomain,
      apiVersion: ApiVersion.January25,
      isEmbeddedApp: false,
    });

    const session = new Session({
      id: 'offline_session',
      shop: config.shopDomain,
      state: 'state',
      isOnline: false,
      accessToken: config.accessToken,
    });

    try {
      const client = new shopify.clients.Rest({ session });
      const response = await client.get({
        path: 'products',
      });

      const products = (response.body as any).products;

      // Map Shopify products to our internal format
      return products.map((p: any) => ({
        id: `shopify_${p.id}`,
        name: p.title,
        description: p.body_html?.replace(/<[^>]*>?/gm, '') || '', // Strip HTML
        price: Number(p.variants[0]?.price || 0),
        category: p.product_type || 'Uncategorized',
        metal_type: p.options.find((o: any) => o.name === 'Material')?.values[0] || 'Unknown',
        gemstone: 'Unknown', // Shopify doesn't have a standard field for this
        weight: p.variants[0]?.weight || 0,
        images: p.images.map((i: any) => i.src),
        sku: p.variants[0]?.sku || '',
        stock_quantity: p.variants.reduce((acc: number, v: any) => acc + (v.inventory_quantity || 0), 0),
        is_featured: false,
        is_bundle: false,
        bundle_discount: 0,
        created_at: p.created_at,
        updated_at: p.updated_at,
      }));
    } catch (error) {
      console.error('Error fetching Shopify products:', error);
      throw error;
    }
  },
  async createProduct(product: {
    name: string
    description?: string
    price: number
    category?: string
    images?: string[]
    sku?: string
  }) {
    const config = await this.getConfig()
    if (!config) {
      throw new Error('Shopify is not configured')
    }
    const shopify = shopifyApi({
      apiKey: config.apiKey || 'dummy_key',
      apiSecretKey: config.apiSecret || 'dummy_secret',
      scopes: ['write_products'],
      hostName: config.shopDomain,
      apiVersion: ApiVersion.January25,
      isEmbeddedApp: false,
    })
    const session = new Session({
      id: 'offline_session',
      shop: config.shopDomain,
      state: 'state',
      isOnline: false,
      accessToken: config.accessToken,
    })
    const client = new shopify.clients.Rest({ session })
    const payload: any = {
      product: {
        title: product.name,
        body_html: product.description || '',
        product_type: product.category || 'Uncategorized',
        variants: [
          {
            price: String(product.price ?? 0),
            sku: product.sku || '',
          },
        ],
        images: (product.images && product.images.length > 0) ? product.images.map((src) => ({ src })) : [],
      },
    }
    const res = await client.post({
      path: 'products',
      data: payload,
    })
    return (res.body as any).product
  }
};
