const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 5000;
require("dotenv").config();

//ObjectID = require('mongodb').ObjectID,

const app = express();

//middleware

app.use(cors());
app.use(express.json());

//

const { MongoClient, ServerApiVersion, ObjectId  } = require("mongodb");
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
    const appointmentOptionsCollection = client.db("doctor").collection("appointmentOptions");
    const bookingsCollection = client.db("doctor").collection("bookings");
    const usersCollection = client.db("doctor").collection("users");
    //get a data from database
    //use aggregate to query multiple collection and then merge data
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      console.log(date);
      const query = {};
      const options = await appointmentOptionsCollection.find(query).toArray();

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
          expiresIn: "2hr",
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
    app.get('/users',async(req,res)=>{
      const query={}
      const users = await usersCollection.find(query).toArray();
      res.send(users);
      
    });
    //get users who are admin
    app.get('/users/admin/:email',async(req,res)=>{
      const email = req.params.email;
      const query = {email}
      const user = await usersCollection.findOne(query);
      res.send({isAdmin: user?.role ==='admin'});

    })

    //add admin role to user
    app.put('/users/admin/:id',verifyJWT,async(req,res)=>{
      //check whether the user is admin or not to control admin making
      const decodedEmail = req.decoded.email;
      const query={email: decodedEmail}
      const user = await usersCollection.findOne(query);
      if(user?.role !=='admin'){
         return res.status(403).send({ message: "forbidden access" });
      }
      //
      const id=req.params.id;
       const filter = { _id: new ObjectId(id) }
      const options={upsert:true};
      const updateDoc={
        $set:{
          role:'admin'
        }
      }
      const result = await usersCollection.updateOne(filter,updateDoc,options);
      res.send(result);

    });


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
