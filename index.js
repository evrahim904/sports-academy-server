const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const app = express();

const port = process.env.PORT || 5000;
// middleware
app.use(cors())
app.use(express.json())

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, message: 'unauthorized access' });
  }
  // bearer token 
  const token = authorization.split(' ')[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    req.decoded = decoded;
    next()
  })
}



const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.iw3n7xd.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const usersCollection = client.db("sportsDB").collection("users");
    const classCollection = client.db("sportsDB").collection("classes");
    const instructorCollection = client.db("sportsDB").collection("instructors");
    const cartCollection = client.db("sportsDB").collection("carts");
    const paymentCollection = client.db("sportsDB").collection("payment");


    // payment method
    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const { price } = req.body;
      if (price) {
        const amount = parseFloat(price) * 100;
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: 'usd',
          payment_method_types: ['card']
        });
        res.send({ clientSecret: paymentIntent.client_secret })
      }
    })
    // payment related apis
    app.get('/payment', verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (email) {
        const result = await paymentCollection.find({ email: email }).toArray();
        res.send(result);
      } else {
        const result = await paymentCollection.find().toArray();
        res.send(result);
      }
    });

    

    app.post('/payment', verifyJWT, async (req, res) => {
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);


      const filter = { _id: new ObjectId(payment.classId) };
      const updateDoc = {
        $inc: {
          availableSeats: -1,
          enrolled: 1
        },
      };
      const updateResult = await classCollection.updateOne(filter, updateDoc);
      



      const query = { _id: new ObjectId(payment.cartId) };
      const deleteResult = await cartCollection.deleteOne(query);

      res.send({ result, deleteResult, updateResult });
    });



    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })

      res.send({ token })
    })


    // verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      // const email = req.decoded.email;
      // const query = { email: email }
      // const user = usersCollection.findOne(query);
      // if (user?.role !== 'admin') {
      //   return res.status(403).send({ error: true, message: 'forbidden access' })
      // }
      // next()

      const email = req.decoded.email;
      const query = { email: email };
      
      try {
        const user = await usersCollection.findOne(query);
    
        if (!user || user.role !== 'admin') {
          return res.status(403).send({ error: true, message: 'forbidden access' });
        }
        
        next();
      } catch (error) {
        return res.status(500).send({ error: true, message: 'Internal Server Error' });
      }

    }

    // verifyInstructor 
    const verifyInstructor = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      
      try {
        const user = await usersCollection.findOne(query);
    
        if (!user || user.role !== 'instructor') {
          return res.status(403).send({ error: true, message: 'forbidden access' });
        }
        
        next();
      } catch (error) {
        return res.status(500).send({ error: true, message: 'Internal Server Error' });
      }
    };
    


    // users collection apis
    app.get('/users', verifyJWT,verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result)
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email }
      const existingUser = await usersCollection.findOne(query);
       
      if (existingUser) {
        return res.send({ message: 'user is already existing' });
      }

      const result = await usersCollection.insertOne(user)
      const instructor = await instructorCollection.insertOne(user)
      res.send({result,instructor})
    })

    app.patch('/users/admin/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          role: 'admin',
        },

      };
      const result = await usersCollection.updateOne(filter, updateDoc)
      res.send(result)
    })
    app.patch('/users/instructor/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          role: 'instructor',
        },

      };
      const result = await usersCollection.updateOne(filter, updateDoc)
      const instructor = await instructorCollection.updateOne(filter, updateDoc)
      res.send({result,instructor})
    })

    app.get('/users/admin/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      if (req.params.email !== email) {
        res.send({ admin: false })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      const result = { admin: user?.role === 'admin' }
      res.send(result)
    })

    app.get('/users/instructor/:email', async (req, res) => {
      const email = req.params.email;
      
      if (req.params.email !== email) {
        res.send({ instructor: false })
      }
      const query = { email: email }
      const user = await usersCollection.findOne(query);
      
      const result = { instructor: user?.role === 'instructor' }
     
      res.send(result)
    })



    // classes section apis


    app.get('/classes', async (req, res) => {
      const email = req.query.email;
      if (email) {
        const result = await classCollection.find({ email: email }).toArray();
        res.send(result);
      } else {
        const result = await classCollection.find().toArray();
        res.send(result);
      }
    });

    app.get('/classes', async (req, res) => {
     

      const result = await classCollection.find().toArray()
      res.send(result)
    })

    app.post('/classes', async (req, res) => {
      const newItem = req.body;
      const result = await classCollection.insertOne(newItem)
      res.send(result)

    })
    app.patch('/classes/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $inc: { availableSeats: -1 },

      };
      const result = await classCollection.updateOne(filter, updateDoc)
      res.send(result)
    })

    app.patch('/classes/status/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: {
          status: 'approved',
        },

      };
      const result = await classCollection.updateOne(filter, updateDoc)
      res.send(result)
    })

    app.patch('/classes/deny/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: 'denied'
        }
      };

      const result = await classCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.patch('/classes/feedback/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          feedback: req.body.feedback,
        }
      };

      const result = await classCollection.updateOne(filter, updateDoc);
      res.send(result);
    });






    // instructors collection  apis
    app.get('/instructors', async (req, res) => {
      const result = await instructorCollection.find().toArray()
      res.send(result)
    })
    // cart collection apis
    app.get('/carts', verifyJWT, async (req, res) => {
      const email = req.query.email;
      console.log(!email)
      if (!email) {
        return res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, message: 'forbidden access' })
      }

      const query = { email: email }
      const result = await cartCollection.find(query).toArray()
      res.send(result)
    })


    app.post('/carts', async (req, res) => {
      const item = req.body;
      const result = await cartCollection.insertOne(item);
      res.send(result)
    })

    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await cartCollection.deleteOne(query)
      res.send(result)
    })



    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);






app.get('/', (req, res) => {
  res.send('sports is playing')
})



app.listen(port, () => {
  console.log(`sports is playing is on: ${port}`)
})