const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());

// MongoDB connection with retry logic
async function connectToMongoDB() {
  let attempts = 5;
  while (attempts > 0) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log('Connected to MongoDB Atlas');
      return;
    } catch (err) {
      console.error(`Failed to connect to MongoDB Atlas (attempt ${6 - attempts}):`, err);
      attempts--;
      if (attempts === 0) throw err;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

connectToMongoDB().catch(err => {
  console.error('MongoDB connection failed after retries:', err);
  process.exit(1);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Attempting to reconnect...');
  connectToMongoDB();
});

// Schema Definitions
const proformaSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  proformaNumber: String,
  customerName: String,
  plateNumber: String,
  vin: String,
  model: String,
  referenceNumber: String,
  deliveryTime: String,
  preparedBy: String,
  dateCreated: String,
  subTotal: Number,
  vat: Number,
  totalAmount: Number,
  lastModified: String,
  userId: Number,
  validityInDays: Number,
  typeOfVehicle: String
});

const itemSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  proformaId: Number,
  itemName: String,
  unit: String,
  quantity: Number,
  unitPrice: Number,
  totalPrice: Number,
  lastModified: String
});

const Proforma = mongoose.model('Proforma', proformaSchema);
const Item = mongoose.model('Item', itemSchema);

// Middleware to check MongoDB connection
const checkMongoConnection = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    console.error('MongoDB connection not ready:', mongoose.connection.readyState);
    return res.status(500).json({ success: false, message: 'Database connection not ready', readyState: mongoose.connection.readyState });
  }
  next();
};

// Health check
app.get('/health', checkMongoConnection, (req, res) => {
  res.status(200).json({ success: true, message: 'Server is healthy', mongoConnected: mongoose.connection.readyState === 1 });
});

// Backup Endpoint
app.post('/backup', checkMongoConnection, async (req, res) => {
  try {
    const { data } = req.body;

    if (!data || !data.proformas || !data.items) {
      return res.status(400).json({ success: false, message: 'Backup data is required' });
    }

    // Upsert Proformas
    for (const proforma of data.proformas) {
      await Proforma.updateOne(
        { id: proforma.id },
        { $set: proforma },
        { upsert: true }
      );
    }

    // Remove old items for each proforma before inserting new ones
    const proformaIds = data.proformas.map(p => p.id);
    await Item.deleteMany({ proformaId: { $in: proformaIds } });

    // Upsert Items
    for (const item of data.items) {
      await Item.updateOne(
        { id: item.id },
        { $set: item },
        { upsert: true }
      );
    }

    res.status(200).json({ success: true, message: 'Backup saved successfully' });
  } catch (error) {
    console.error('Error saving backup:', error);
    res.status(500).json({ success: false, message: 'Failed to save backup', error: error.message });
  }
});

// GET Proformas
app.get('/proformas', checkMongoConnection, async (req, res) => {
  try {
    const proformas = await Proforma.find({})
      .sort({ dateCreated: -1, lastModified: -1 })
      .exec();

    const items = await Item.find({
      proformaId: { $in: proformas.map(p => p.id) }
    }).exec();

    const response = proformas.map(p => ({
      proformaNumber: p.proformaNumber,
      customerName: p.customerName,
      plateNumber: p.plateNumber,
      vin: p.vin,
      model: p.model,
      referenceNumber: p.referenceNumber,
      deliveryTime: p.deliveryTime,
      preparedBy: p.preparedBy,
      dateCreated: p.dateCreated,
      lastModified: p.lastModified,
      subTotal: p.subTotal,
      vat: p.vat,
      totalAmount: p.totalAmount,
      validityInDays: p.validityInDays,
      typeOfVehicle: p.typeOfVehicle,
      items: items
        .filter(i => i.proformaId === p.id)
        .map(i => ({
          itemName: i.itemName,
          unit: i.unit,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          totalPrice: i.totalPrice
        }))
    }));

    res.status(200).json({
      success: true,
      proformas: response,
      count: response.length,
      latestModified: proformas[0]?.lastModified
    });
  } catch (error) {
    console.error('Full proforma fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// Debug Endpoint
app.get('/debug-proformas', async (req, res) => {
  const dbCount = await Proforma.countDocuments();
  const apiCount = (await Proforma.find().lean()).length;

  res.json({
    dbCount,
    apiCount,
    discrepancy: dbCount - apiCount,
    sampleRecord: await Proforma.findOne().lean()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backup server running on port ${PORT}`);
});
