import { Router } from 'express'
import { supabase } from '../../db/supabase.js'
import { configService } from '../../services/config.js'
import { shopifyService } from '../../services/shopify.js'

const router = Router()

interface Product {
  id: string
  name: string
  price: number
  description?: string
  stock: number
  images?: string[]
  is_bundle?: boolean
  min_price?: number
}

// Fallback in-memory store if DB is not configured
let localProducts: Product[] = []
const useDb = !!process.env.SUPABASE_URL

const validateProduct = (body: any, partial = false) => {
  const errors: string[] = []
  
  if (!partial) {
    if (!body.name) errors.push('Name is required')
    if (typeof body.price !== 'number') errors.push('Price must be a number')
  }

  if (body.price !== undefined && typeof body.price !== 'number') {
    errors.push('Price must be a number')
  }

  if (body.stock !== undefined && (typeof body.stock !== 'number' || body.stock < 0)) {
    errors.push('Stock must be a non-negative number')
  }

  if (body.min_price !== undefined && (typeof body.min_price !== 'number' || body.min_price < 0)) {
    errors.push('Min price must be a non-negative number')
  }

  if (body.images !== undefined && (!Array.isArray(body.images) || !body.images.every((i: any) => typeof i === 'string'))) {
    errors.push('Images must be an array of strings')
  }

  if (body.is_bundle !== undefined && typeof body.is_bundle !== 'boolean') {
    errors.push('is_bundle must be a boolean')
  }

  return errors
}

router.get('/health', (req, res) => {
  res.json({ status: 'ok', storage: useDb ? 'supabase' : 'memory' })
})

router.get('/stats', async (req, res) => {
  if (useDb) {
    const { count, error } = await supabase.from('products').select('*', { count: 'exact', head: true })
    if (error) {
        // Fallback to 0 if table doesn't exist yet
        res.json({ users: 0, products: 0, orders: 0, error: error.message })
        return
    }
    res.json({ users: 0, products: count || 0, orders: 0 })
  } else {
    res.json({ users: 0, products: localProducts.length, orders: 0 })
  }
})

router.get('/products', async (req, res) => {
  if (useDb) {
    const { data, error } = await supabase.from('products').select('*')
    if (error) {
        res.status(500).json({ error: error.message })
        return
    }
    res.json({ items: data })
  } else {
    res.json({ items: localProducts })
  }
})

router.post('/products', async (req, res) => {
  const { name, price, description, stock, images, is_bundle, min_price } = req.body
  
  const errors = validateProduct(req.body)
  if (errors.length > 0) {
    res.status(400).json({ error: errors.join(', ') })
    return
  }

  const productData = {
    name,
    price,
    description: description || '',
    stock: stock || 0,
    images: images || [],
    is_bundle: is_bundle || false,
    min_price
  }

  if (useDb) {
    const { data, error } = await supabase
        .from('products')
        .insert([productData])
        .select()
        .single()
    
    if (error) {
        res.status(500).json({ error: error.message })
        return
    }
    res.status(201).json(data)
  } else {
    const newProduct: Product = {
        id: Date.now().toString(),
        ...productData
    }
    localProducts.push(newProduct)
    res.status(201).json(newProduct)
  }
})

router.patch('/products/:id', async (req, res) => {
  const { id } = req.params
  
  const errors = validateProduct(req.body, true)
  if (errors.length > 0) {
    res.status(400).json({ error: errors.join(', ') })
    return
  }

  // Sanitize input to only allowed fields
  const allowedFields = ['name', 'price', 'description', 'stock', 'images', 'is_bundle', 'min_price']
  const updates: any = {}
  Object.keys(req.body).forEach(key => {
    if (allowedFields.includes(key)) {
      updates[key] = req.body[key]
    }
  })

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields to update' })
    return
  }

  if (useDb) {
    const { data, error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id)
        .select()
        .single()
    
    if (error) {
        res.status(500).json({ error: error.message })
        return
    }
    if (!data) {
        res.status(404).json({ error: 'Product not found' })
        return
    }
    res.json(data)
  } else {
    const index = localProducts.findIndex(p => p.id === id)
    if (index === -1) {
        res.status(404).json({ error: 'Product not found' })
        return
    }
    
    localProducts[index] = { ...localProducts[index], ...updates }
    res.json(localProducts[index])
  }
})

router.delete('/products/:id', async (req, res) => {
    const { id } = req.params

    if (useDb) {
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', id)
        
        if (error) {
            res.status(500).json({ error: error.message })
            return
        }
        res.json({ success: true })
    } else {
        const initialLength = localProducts.length
        localProducts = localProducts.filter(p => p.id !== id)
        
        if (localProducts.length === initialLength) {
            res.status(404).json({ error: 'Product not found' })
            return
        }
        res.json({ success: true })
    }
})

router.get('/orders', (req, res) => {
  res.json({ items: [] })
})

router.get('/system/info', (req, res) => {
  res.json({ 
      node: process.version, 
      env: process.env.NODE_ENV || 'development',
      db: useDb ? 'connected' : 'not_configured'
  })
})

router.get('/config/:service', async (req, res) => {
  const { service } = req.params
  const config = await configService.getConfig(service)
  if (!config) {
    res.json({ service, config: {}, is_active: false })
    return
  }
  res.json(config)
})

router.post('/config/:service', async (req, res) => {
  const { service } = req.params
  const { config, is_active } = req.body

  try {
    const updated = await configService.updateConfig(service, config, is_active)
    res.json(updated)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/shopify/sync', async (req, res) => {
  try {
    const configured = await shopifyService.isConfigured()
    if (!configured) {
      res.status(503).json({ error: 'Shopify integration not configured' })
      return
    }
    if (!useDb) {
      res.status(503).json({ error: 'Database not configured' })
      return
    }
    const products = await shopifyService.getProducts()
    const payload = products.map((p: any) => ({
      name: p.name,
      description: p.description,
      price: p.price,
      category: p.category,
      metal_type: p.metal_type,
      gemstone: p.gemstone,
      weight: p.weight,
      images: p.images,
      sku: p.sku,
      stock_quantity: p.stock_quantity,
      is_featured: p.is_featured,
      is_bundle: p.is_bundle,
      bundle_discount: p.bundle_discount,
    }))
    const { data, error } = await supabase
      .from('products')
      .upsert(payload, { onConflict: 'sku' })
      .select()
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ count: data?.length || 0 })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/shopify/push/:id', async (req, res) => {
  try {
    const configured = await shopifyService.isConfigured()
    if (!configured) {
      res.status(503).json({ error: 'Shopify integration not configured' })
      return
    }
    if (!useDb) {
      res.status(503).json({ error: 'Database not configured' })
      return
    }
    const { id } = req.params
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single()
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    if (!data) {
      res.status(404).json({ error: 'Product not found' })
      return
    }
    const created = await shopifyService.createProduct({
      name: data.name,
      description: data.description,
      price: Number(data.price),
      category: data.category,
      images: Array.isArray(data.images) ? data.images : [],
      sku: data.sku,
    })
    res.json({ id: created?.id, title: created?.title })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

export const adminRoutes = router
