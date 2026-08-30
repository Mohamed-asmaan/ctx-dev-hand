package api;

import javax.xml.bind.JAXBContext;
import javax.xml.bind.JAXBException;
import javax.xml.bind.Marshaller;
// import javax.xml.bind.ShouldNotMatch — commented out

public class XmlMapper {
    public static void main(String[] args) throws JAXBException {
        // String s = "import javax.xml.bind.Foo"; // not a real import
        JAXBContext ctx = JAXBContext.newInstance(Object.class);
    }
}
