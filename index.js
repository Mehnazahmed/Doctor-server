const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 5000;
require("dotenv").config();
// for payment
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

//ObjectID = require('mongodb').ObjectID,

const app = express();

//middleware

app.use(cors());
app.use(express.json());

//

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.sn1j5xu.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri);

//
function verifyJWT(req, res, next) {
  //headers from client site
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.send(401).send("Unauthorized access");
  }
  //need to split the header to get the full token
  const token = authHeader.split(" ")[1];
  //verify token
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const appointmentOptionsCollection = client
      .db("doctor")
      .collection("appointmentOptions");
    const bookingsCollection = client.db("doctor").collection("bookings");
    const usersCollection = client.db("doctor").collection("users");
    const doctorsCollection = client.db("doctor").collection("doctors");
    const paymentsCollection = client.db("doctor").collection("payments");
    //get a data from database
    //Note: use aggregate to query multiple collection and then merge data
    //Note: make sure to use verifyAdmin after verifyJwt
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      console.log(date);
      const query = {};
      const options = await appointmentOptionsCollection.find(query).toArray();
      //booking  query depending on conditions
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();
      options.forEach((option) => {
        const bookedOption = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        const bookedSlots = bookedOption.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        option.slots = remainingSlots;
      });

      res.send(options);
    });
    //get a specific attribute from an existing collection using project
    app.get("/doctorsspecialty", async (req, res) => {
      const query = {};
      const result = await appointmentOptionsCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });

    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      //control user info access
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }
      //
      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    //post a data to database  => send data from client side
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      console.log(booking);

      //query to limit order using user info
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment,
      };
      const bookedAlready = await bookingsCollection.find(query).toArray();
      if (bookedAlready.length) {
        const message = `you already have a booking on ${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }
      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    //get jwt token
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        //create jwt token
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "245hr",
        });
        return res.send({ accessToken: token });
      }
      console.log(user);
      res.status(403).send({ accessToken: "" });
    });

    //post user info
    app.post("/users", async (req, res) => {
      const users = req.body;
      const result = await usersCollection.insertOne(users);
      res.send(result);
    });
    //get users
    app.get("/users", async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });
    //get users who are admin
    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "admin" });
    });

    //get bookings data using params
    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    //payment
    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    //update...add admin role to user
    app.put("/users/admin/:id", verifyJWT, async (req, res) => {
      //check whether the user is admin or not to control admin making//verify admin role

      // const decodedEmail = req.decoded.email;
      // const query={email: decodedEmail}
      // const user = await usersCollection.findOne(query);
      // if(user?.role !=='admin'){
      //    return res.status(403).send({ message: "forbidden access" });
      // }
      //
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await usersCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    //add doctor info to database
    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      //query for adding one email address only once
      const query = { email: doctor.email };
      const alreadyAddedDoctor = await doctorsCollection.find(query).toArray();
      if (alreadyAddedDoctor.length) {
        const message = `${doctor.email} already added`;
        return res.send({ acknowledged: false, message });
      }
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    });
    //get doctors data from server
    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors);
    });
    //delete doctor
    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });

    //post payment info
    app.post('/payments',async(req,res)=>{
      const payment =req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id=payment.bookingId;
      const filter ={_id: new ObjectId(id)}
      const updateDoc={
        $set:{
          paid: true,
          transactionId: payment.transactionId
        }
      
      }
      const updatedResult = await bookingsCollection.updateOne(filter,updateDoc)
      res.send(result);
    })

    //Temporary to update price field on appointment options
    // app.get('/addprice', async(req,res)=>{
    //   const filter ={}
    //   const options = {upsert:true};
    //   const updateDoc={
    //     $set:{
    //       price:'99'
    //     }
    //   }
    //   const result = await appointmentOptionsCollection.updateMany(filter,updateDoc,options);
    //   res.send(result);
    // });
  } finally {
  }
}
// / ***
// *basic API naming convention
// *app.get('/bookings')
// *app.get('/bookings/:id')
// *app.post('/bookings')
// *app.patch('/bookings')
// *app.delete('/bookings/:id')
//
run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("doctor portar is running");
});

app.listen(port, () => console.log(`doctor portal running on ${port}`));
